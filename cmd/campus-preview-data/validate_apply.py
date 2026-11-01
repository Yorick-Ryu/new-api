"""Validate the dated fixture; optionally merge only its delta into local preview.

Fixed paths are intentional. This cannot select a production database. No source
credentials or complete user records are written to reports or standard output.
"""
import collections
import datetime as dt
import decimal
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys

ARTIFACT = Path('/Users/yorick/Servers/artifacts/campus-preview-data-20261101')
LIVE = Path('/Users/yorick/Servers/new-api/one-api.db')
BATCH = 'CPDEMO20261101'
NEW_TABLES = {
    'users', 'campus_members', 'campus_payments', 'campus_entries',
    'campus_withdrawals', 'campus_allocations', 'logs', 'top_ups',
    'subscription_orders', 'user_subscriptions', 'user_subscription_quota_windows',
}
OLD_COLUMNS = {
    'campus_campaigns': {'revision'},
    'campus_members': {'joined_at', 'performance'},
    'campus_windows': {'start'},
}
checks = collections.Counter()


def check(condition, category, context=''):
    if not condition:
        raise RuntimeError(f'Validation failed: {category} {context}')
    checks[category] += 1


def connect(path, readonly=True):
    check(path.is_file() and not path.is_symlink(), 'fixed regular database file', path.name)
    conn = sqlite3.connect(f'file:{path}?mode={"ro" if readonly else "rw"}', uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def rows(conn, table):
    return [dict(row) for row in conn.execute(f'SELECT * FROM "{table}"')]


def table_key(conn, table):
    columns = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
    return [col['name'] for col in sorted(columns, key=lambda c: c['pk']) if col['pk']]


def row_key(row, columns):
    return tuple(row[col] for col in columns)


def cents(value):
    return int((decimal.Decimal(str(value)) * 100).to_integral_value(rounding=decimal.ROUND_HALF_UP))


def validate():
    before, stage = connect(ARTIFACT / 'before.db'), connect(ARTIFACT / 'staging.db')
    tables = [r[0] for r in before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    check(before.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'SQLite integrity')
    check(stage.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'SQLite integrity')
    check(not stage.execute('PRAGMA foreign_key_check').fetchall(), 'SQLite foreign keys')
    additions, updates, data = {}, {}, {}
    for table in tables:
        original, current = rows(before, table), rows(stage, table)
        data[table] = current
        keys = table_key(stage, table)
        if not keys:
            check(original == current, 'unchanged table without primary key', table)
            continue
        old = {row_key(row, keys): row for row in original}
        new = {row_key(row, keys): row for row in current}
        check(old.keys() <= new.keys(), 'no deleted original rows', table)
        extra = [new[key] for key in new.keys() - old.keys()]
        if extra:
            check(table in NEW_TABLES, 'new rows restricted to fixture tables', table)
            additions[table] = extra
        for key, row in old.items():
            changed = {col for col in row if row[col] != new[key][col]}
            if changed:
                check(changed <= OLD_COLUMNS.get(table, set()), 'original field preservation', table)
                check(key == (1,), 'only preview owner and campaign history updated', table)
                updates.setdefault(table, []).append((key, row, new[key], changed))
            else:
                checks['unchanged original rows'] += 1

    users = {row['id']: row for row in additions['users']}
    members = {row['user_id']: row for row in data['campus_members']}
    payments = {row['id']: row for row in data['campus_payments']}
    topups = {row['trade_no']: row for row in additions['top_ups']}
    subscriptions = {row['id']: row for row in additions['user_subscriptions']}
    orders = {row['trade_no']: row for row in additions['subscription_orders']}
    withdrawals = {row['id']: row for row in data['campus_withdrawals']}
    entries = additions['campus_entries']
    config = data['campus_campaigns'][0]
    tiers = json.loads(config['tiers_json'])
    rates = {v['plan_id']: v['rate_bps'] for v in json.loads(config['plan_rates_json'])}
    manifest = json.loads((ARTIFACT / 'dataset-manifest.json').read_text())
    generated = int(dt.datetime.fromisoformat(manifest['generated_at']).timestamp())
    now = int(dt.datetime.now().timestamp())
    check(len(users) == 28 and len(payments) == 64 and len(topups) == 64, 'expected dataset size')
    check(len(orders) == 4 and len(subscriptions) == 3, 'purchase and renewal entitlement count')
    check(len({p['trade_no'] for p in payments.values()}) == 64, 'unique merchant order numbers')
    successful = [p for p in payments.values() if p['settled_at']]
    check(len(successful) == 62 and len({p['provider_trade'] for p in successful}) == 62, 'unique paid provider references')
    check(collections.Counter(t['status'] for t in topups.values()) == {'success': 62, 'pending': 1, 'failed': 1}, 'payment states')
    check(sum(m['inviter_id'] == 1 for m in members.values()) == 24, 'direct invitation count')
    check(sum(m['inviter_id'] in users for m in members.values()) == 4, 'indirect invitation count')
    for uid, user in users.items():
        member = members[uid]
        check(user['username'].startswith('cpdemo1101_') and BATCH in user['remark'], 'synthetic user marker', str(uid))
        check(all(not user[field] for field in ['password', 'access_token', 'github_id', 'discord_id', 'oidc_id', 'wechat_id', 'telegram_id', 'linux_do_id', 'stripe_customer']), 'synthetic users have no credentials', str(uid))
        check(user['role'] == 1 and user['used_quota'] == 0 and user['request_count'] == 0, 'synthetic ordinary users without fabricated consumption', str(uid))
        check(user['created_at'] <= member['bound_at'] <= generated, 'invitation chronology', str(uid))
        check(members[member['inviter_id']]['joined_at'] <= member['bound_at'], 'inviter joined before binding', str(uid))
        paid = [p for p in successful if p['user_id'] == uid]
        check(member['first_paid_at'] == min((p['settled_at'] for p in paid), default=0), 'first payment matches history', str(uid))
        credit = sum(t['amount'] for t in topups.values() if t['user_id'] == uid and t['status'] == 'success')
        check(user['quota'] == credit * 500000, 'wallet credits match successful recharge amounts', str(uid))
        coupon_orders = [p for p in payments.values() if p['user_id'] == uid and p['coupon'] and topups[p['trade_no']]['status'] != 'failed']
        check(len(coupon_orders) <= 1, 'one personal coupon', str(uid))
        if member['coupon_state'] == 'available':
            check(not member['coupon_trade'] and not coupon_orders, 'available coupon released or unused', str(uid))
        else:
            check(len(coupon_orders) == 1 and member['coupon_trade'] == coupon_orders[0]['trade_no'], 'coupon linked to own order', str(uid))
            check(member['coupon_state'] == ('used' if coupon_orders[0]['settled_at'] else 'reserved'), 'coupon payment state', str(uid))
        check(sum(e['kind'] == 'bound' and e['user_id'] == uid for e in entries) == 1, 'binding audit record', str(uid))

    performance = collections.Counter()
    for p in sorted(payments.values(), key=lambda p: p['id']):
        t, member = topups[p['trade_no']], members[p['user_id']]
        label = p['trade_no']
        check(p['user_id'] in users and t['user_id'] == p['user_id'], 'payment owner linkage', label)
        check(p['paid'] == cents(t['money']) and p['currency'] == 'CNY' and p['main_site'] == 1, 'CNY cash matches order', label)
        check(t['payment_method'] == 'alipay', 'Alipay payment method', label)
        check(member['bound_at'] <= t['create_time'] <= generated, 'checkout chronology', label)
        check(p['paid'] == (p['before'] * 95 + 50) // 100 if p['coupon'] else p['paid'] == p['before'], '95 percent coupon arithmetic', label)
        check(not p['refunded'] and not p['reversed'] and not p['offset'], 'no refund fixtures', label)
        check(sum(p[field] for field in ['frozen', 'available', 'reserved', 'paid_out', 'offset']) == p['commission'], 'per-order commission conservation', label)
        if not p['settled_at']:
            check(t['status'] in ('pending', 'failed') and not t['complete_time'] and not p['commission'] and not p['provider_trade'], 'unpaid order has no settlement or commission', label)
            continue
        check(t['create_time'] <= p['settled_at'] == t['complete_time'] <= generated, 'settlement chronology', label)
        check(p['eligibility'] == 'eligible' and p['inviter_id'] == member['inviter_id'], 'direct inviter receives commission', label)
        check(p['provider_trade'].startswith('epay:SIM-' + BATCH), 'synthetic verified Epay proof', label)
        check(data['campus_windows'][0]['start'] <= p['settled_at'], 'settlement inside activity window', label)
        exact, expected_segments = 0, []
        if p['product'] == 'subscription':
            o = orders[label]
            check(o['plan_id'] == p['plan_id'] and o['user_id'] == p['user_id'] and cents(o['money']) == p['paid'] and o['status'] == 'success' and o['complete_time'] == p['settled_at'], 'subscription order settlement linkage', label)
            check(t['amount'] == 0 and not t['payment_provider'] and o['payment_provider'] == 'epay', 'subscription summary does not credit wallet', label)
            exact = p['paid'] * rates[p['plan_id']]
            expected_segments = [{'base_cents': p['paid'], 'rate_percent': rates[p['plan_id']] / 100}]
        else:
            check(t['payment_provider'] == 'epay', 'wallet uses Epay provider', label)
            left, prior = p['paid'], performance[p['inviter_id']]
            for i, tier in enumerate(tiers):
                ceiling = tiers[i + 1]['floor_cents'] if i + 1 < len(tiers) else prior + left
                base = min(left, max(0, ceiling - max(prior, tier['floor_cents'])))
                if base:
                    expected_segments.append({'base_cents': base, 'rate_percent': tier['rate_bps'] / 100})
                    exact += base * tier['rate_bps']
                    left -= base
                    prior += base
            check(left == 0, 'tier covers entire payment', label)
        check(p['commission'] == (exact + 5000) // 10000 and json.loads(p['segments']) == expected_segments, 'historical tier and exact commission calculation', label)
        performance[p['inviter_id']] += p['paid']
        related = [e for e in entries if e['kind'] == 'commission' and e['payment_id'] == p['id']]
        check(len(related) == 1 and related[0]['user_id'] == p['inviter_id'] and related[0]['amount'] == p['commission'] and related[0]['created_at'] == p['settled_at'], 'unique commission audit record', label)
        logs = [r for r in additions['logs'] if json.loads(r['other']).get('trade_no') == label]
        check(len(logs) == 1 and logs[0]['user_id'] == p['user_id'] and logs[0]['created_at'] == p['settled_at'] and json.loads(logs[0]['other'])['simulation_batch'] == BATCH, 'topup log traceability', label)
        check((p['settled_at'] + 168 * 3600 > generated) == bool(p['frozen']), '168 hour commission freeze', label)
    for uid, member in members.items():
        check(member['performance'] == performance[uid], 'member performance reconciliation', str(uid))

    active_states = {'pending', 'approved', 'paused', 'unknown'}
    check({w['state'] for w in withdrawals.values()} == active_states | {'paid', 'rejected', 'failed'}, 'seven withdrawal states')
    for wid, w in withdrawals.items():
        allocations = [a for a in data['campus_allocations'] if a['withdrawal_id'] == wid]
        check(sum(a['amount'] for a in allocations) == (w['amount'] if w['state'] in active_states | {'paid'} else 0), 'withdrawal allocation total', str(wid))
        check(w['created_at'] <= w['updated_at'] <= now, 'withdrawal chronology', str(wid))
        for a in allocations:
            p = payments[a['payment_id']]
            check(p['inviter_id'] == w['user_id'] and p['settled_at'] + 168 * 3600 <= w['created_at'], 'withdrawal funded by matured own commission', str(wid))
        history = [e for e in entries if e['withdrawal_id'] == wid]
        check(sum(e['kind'] == 'withdrawal_requested' for e in history) == 1, 'withdrawal request audit', str(wid))
        check(all(w['created_at'] <= e['created_at'] <= w['updated_at'] for e in history), 'withdrawal audit chronology', str(wid))
        if w['state'] == 'paid':
            check(w['created_at'] <= w['paid_at'] == w['updated_at'] and w['receipt'].startswith('SIM-' + BATCH), 'simulated payout receipt', str(wid))
    for pid, p in payments.items():
        allocations = [a for a in data['campus_allocations'] if a['payment_id'] == pid]
        check(p['reserved'] == sum(a['amount'] for a in allocations if withdrawals[a['withdrawal_id']]['state'] in active_states), 'per-order withdrawal reservation', str(pid))
        check(p['paid_out'] == sum(a['amount'] for a in allocations if withdrawals[a['withdrawal_id']]['state'] == 'paid'), 'per-order paid allocation', str(pid))

    for sid, sub in subscriptions.items():
        initial = [o for o in orders.values() if o['user_id'] == sub['user_id'] and o['plan_id'] == sub['plan_id'] and not o['renewal_subscription_id']]
        renewal = [o for o in orders.values() if o['renewal_subscription_id'] == sid]
        check(len(initial) == 1 and all(o['user_id'] == sub['user_id'] and o['plan_id'] == sub['plan_id'] for o in renewal), 'entitlement purchase and renewal owner', str(sid))
        start = dt.datetime.fromtimestamp(sub['start_time'], dt.timezone.utc)
        expected_end = start.replace(month=start.month + 1 + len(renewal))
        check(sub['created_at'] == sub['start_time'] == initial[0]['complete_time'] and sub['end_time'] == int(expected_end.timestamp()), 'monthly entitlement duration plus renewal', str(sid))
        check(sub['start_time'] <= sub['last_reset_time'] <= generated < sub['next_reset_time'] <= sub['end_time'], 'current weekly quota window', str(sid))
        check(sub['next_reset_time'] - sub['last_reset_time'] == 604800 and (sub['last_reset_time'] - sub['start_time']) % 604800 == 0, 'weekly quota anchor', str(sid))
        windows = [q for q in additions['user_subscription_quota_windows'] if q['user_subscription_id'] == sid]
        check(len(windows) == 1 and windows[0]['created_at'] == sub['start_time'] and windows[0]['window_start'] == sub['start_time'] <= generated < windows[0]['next_reset_time'] <= sub['end_time'], 'monthly quota window links to purchase', str(sid))
    check(all(BATCH in e['reason'] for e in entries), 'all new campus audit rows marked simulated')
    totals = {field: sum(p[field] for p in successful if p['inviter_id'] == 1) for field in ['paid', 'commission', 'frozen', 'available', 'reserved', 'paid_out']}
    report = {'batch': BATCH, 'source_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'validated_at': dt.datetime.now().astimezone().isoformat(), 'checks': dict(checks), 'assertions': sum(checks.values()), 'new_rows': {t: len(v) for t, v in additions.items()}, 'modified_original_columns': {t: sorted(set().union(*(u[3] for u in v))) for t, v in updates.items()}, 'owner_totals_cents': totals, 'production_writes': False}
    (ARTIFACT / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    os.chmod(ARTIFACT / 'validation.json', 0o600)
    return before, stage, tables, additions, updates, report


def apply_local(before, stage, tables, additions, updates, report):
    live = connect(LIVE, readonly=False)
    # Acquire the SQLite write lock before checking drift. Never replace the live
    # file: active sessions and independent heartbeat updates must survive.
    live.execute('BEGIN IMMEDIATE')
    try:
        protected = {}
        for table in tables:
            current = rows(live, table)
            protected[table] = current
            if table not in {'system_instances', 'user_sessions'}:
                check(current == rows(before, table), 'local baseline unchanged before import', table)
        for table, new_rows in additions.items():
            cols = list(new_rows[0])
            sql = f'INSERT INTO "{table}" (' + ','.join(f'"{c}"' for c in cols) + ') VALUES (' + ','.join('?' for _ in cols) + ')'
            live.executemany(sql, [[row[c] for c in cols] for row in new_rows])
        for table, changed_rows in updates.items():
            keys = table_key(live, table)
            for key, old, new, columns in changed_rows:
                columns = sorted(columns)
                sql = f'UPDATE "{table}" SET ' + ','.join(f'"{c}"=?' for c in columns) + ' WHERE ' + ' AND '.join(f'"{c}"=?' for c in keys)
                live.execute(sql, [new[c] for c in columns] + list(key))
        for table in tables:
            current = rows(live, table)
            expected = rows(stage, table) if table in additions or table in updates else protected[table]
            keys = table_key(live, table)
            if keys:
                current.sort(key=lambda r: row_key(r, keys))
                expected.sort(key=lambda r: row_key(r, keys))
            check(current == expected, 'exact delta import and unrelated data preservation', table)
        check(live.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'import integrity')
        check(not live.execute('PRAGMA foreign_key_check').fetchall(), 'import foreign keys')
        live.commit()
    except BaseException:
        live.rollback()
        raise
    report['applied_to'] = str(LIVE)
    report['applied_at'] = dt.datetime.now().astimezone().isoformat()
    report['checks'] = dict(checks)
    report['assertions'] = sum(checks.values())
    (ARTIFACT / 'applied.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    os.chmod(ARTIFACT / 'applied.json', 0o600)
    print('Applied verified delta to existing local preview; original users and sessions preserved.')


if __name__ == '__main__':
    check(sys.argv[1:] in ([], ['--apply-local']), 'explicit supported invocation')
    result = validate()
    print(f'Validated {sum(checks.values())} invariants; 28 users, 64 orders, 7 withdrawals.')
    if sys.argv[1:]:
        apply_local(*result)
