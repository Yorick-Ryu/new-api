// campus-preview-data creates explicitly requested, traceable local simulation
// records in a staging COPY. It cannot select a production DSN or the live DB.
package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/model"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const batch = "CPDEMO20261101"
const stagingPath = "/Users/yorick/Servers/artifacts/campus-preview-data-20261101/staging.db"

type event struct {
	User   int
	At     time.Time
	Cash   int
	Credit int64
	Coupon bool
	Plan   int
	Renew  bool
	State  string
}

type generator struct {
	db           *gorm.DB
	users        []model.User
	start        time.Time
	now          time.Time
	initialEntry int64
	orders       []map[string]any
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func main() {
	if len(os.Args) != 2 || os.Args[1] != "--staging-copy-only" {
		panic("requires --staging-copy-only")
	}
	info, err := os.Stat(stagingPath)
	must(err)
	if !info.Mode().IsRegular() {
		panic("staging DB must be a regular file")
	}
	must(os.Setenv("SQL_DSN", "local"))
	must(os.Setenv("LOG_SQL_DSN", ""))
	common.SQLitePath = stagingPath + "?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate"
	common.IsMasterNode, common.RedisEnabled = false, false
	common.QuotaForNewUser, common.QuotaForInviter, common.QuotaForInvitee = 0, 0, 0
	must(model.InitDB())
	model.LOG_DB = model.DB
	model.DB.Logger = logger.Default.LogMode(logger.Silent)
	gin.SetMode(gin.TestMode)
	operation_setting.PayAddress = "https://simulation.invalid"
	operation_setting.EpayId = "local-simulation"
	operation_setting.EpayKey = common.GetRandomString(48)
	operation_setting.PayMethods = []map[string]string{{"type": "alipay", "name": "Alipay"}}
	payment := operation_setting.GetPaymentSetting()
	payment.ComplianceConfirmed = true
	payment.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	zone := time.FixedZone("Asia/Shanghai", 8*3600)
	now := time.Now().In(zone)
	if now.Year() != 2026 || now.Month() != time.November || now.Day() != 1 {
		panic("dated fixture must be reviewed before another day")
	}
	g := &generator{db: model.DB, now: now, start: time.Date(2026, 10, 1, 9, 0, 0, 0, zone)}
	var existing int64
	must(g.db.Model(&model.CampusPayment{}).Count(&existing).Error)
	if existing != 0 {
		panic("refuse to overwrite an existing campaign dataset")
	}
	must(g.db.Model(&model.CampusEntry{}).Select("COALESCE(MAX(id),0)").Scan(&g.initialEntry).Error)
	var owner model.CampusMember
	must(g.db.First(&owner, "user_id = ?", 1).Error)
	if owner.JoinedAt == 0 || owner.Performance != 0 {
		panic("preview owner must be joined and have no existing campaign sales")
	}
	var windows []model.CampusWindow
	must(g.db.Find(&windows).Error)
	if len(windows) != 1 || windows[0].Stop != 0 {
		panic("expected a single active local campaign window")
	}
	// Historical dates are part of the simulation, explicitly recorded below.
	must(g.db.Model(&windows[0]).Update("start", g.start.Unix()).Error)
	must(g.db.Model(&owner).Update("joined_at", g.start.Unix()).Error)
	must(g.db.Model(&model.CampusEntry{}).Where("user_id = ? AND kind = ?", 1, "joined").Update("created_at", g.start.Unix()).Error)
	names := []string{"林晓", "陈宇", "周宁", "李悦", "张晨", "王然", "赵敏", "刘洋", "孙琪", "郑安", "吴桐", "许晴", "何川", "高远", "徐沐", "唐逸", "宋澄", "谢薇", "梁羽", "韩星", "罗欣", "马可", "顾言", "苏禾", "秦明", "程璐", "沈哲", "陆瑶"}
	for i, name := range names {
		registered := g.start.AddDate(0, 0, 1+i%6).Add(time.Hour)
		if i >= 20 && i < 24 {
			registered = now.Add(-time.Duration(24-i) * 4 * time.Hour)
		} else if i >= 24 {
			registered = now.Add(-time.Duration(28-i) * 8 * time.Hour)
		}
		invitation := owner.Code
		if i >= 24 {
			var first model.CampusMember
			must(g.db.First(&first, "user_id = ?", g.users[0].Id).Error)
			invitation = first.Code
		}
		user := model.User{Username: fmt.Sprintf("cpdemo1101_%02d", i+1), DisplayName: name + "（模拟）", Email: fmt.Sprintf("campus-demo-%02d@example.test", i+1), Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", CreatedAt: registered.Unix(), AuthVersion: 1, Remark: "本地 UI 模拟批次 " + batch, CampusCode: invitation}
		// No password, external identity, token or login session is provisioned.
		must(user.Insert(0))
		g.users = append(g.users, user)
		must(g.db.Model(&model.CampusMember{}).Where("user_id = ?", user.Id).Update("bound_at", registered.Add(time.Minute).Unix()).Error)
		must(g.db.Model(&model.CampusEntry{}).Where("user_id = ? AND kind = ?", user.Id, "bound").Update("created_at", registered.Add(time.Minute).Unix()).Error)
		if i == 0 {
			_, err := model.CampusJoin(user.Id)
			must(err)
			must(g.db.Model(&model.CampusMember{}).Where("user_id = ?", user.Id).Update("joined_at", registered.Add(2*time.Minute).Unix()).Error)
			must(g.db.Model(&model.CampusEntry{}).Where("user_id = ? AND kind = ?", user.Id, "joined").Update("created_at", registered.Add(2*time.Minute).Unix()).Error)
		}
	}
	var events []event
	first := []int{1000, 20, 10, 200, 10, 1000, 20, 5, 100, 20, 1000, 10, 20, 50, 10, 1000, 20, 200}
	for i, cash := range first {
		at := time.Unix(g.users[i].CreatedAt, 0).In(zone).Add(2 * time.Hour)
		credit := int64(cash)
		if cash == 200 {
			credit = 220
		}
		if cash == 1000 {
			credit = 1200
		}
		events = append(events, event{User: i, At: at, Cash: cash, Credit: credit, Coupon: true, State: "success"})
		cash2 := []int{10, 20, 100, 200, 5, 50}[i%6]
		credit2 := int64(cash2)
		if cash2 == 200 {
			credit2 = 220
		}
		events = append(events, event{User: i, At: at.AddDate(0, 0, 9), Cash: cash2, Credit: credit2, State: "success"})
		events = append(events, event{User: i, At: now.Add(-time.Duration(4+i%90) * time.Hour), Cash: []int{10, 20, 2}[i%3], Credit: int64([]int{10, 20, 2}[i%3]), State: "success"})
	}
	for i, plan := range []int{6, 7, 6} {
		events = append(events, event{User: i + 1, At: g.start.AddDate(0, 0, 8+i).Add(3 * time.Hour), Plan: plan, State: "success"})
	}
	events = append(events, event{User: 1, At: g.start.AddDate(0, 0, 28).Add(3 * time.Hour), Plan: 6, Renew: true, State: "success"})
	events = append(events, event{User: 18, At: now.Add(-5 * time.Hour), Cash: 20, Credit: 20, Coupon: true, State: "pending"})
	events = append(events, event{User: 19, At: now.Add(-4 * time.Hour), Cash: 10, Credit: 10, Coupon: true, State: "failed"})
	for i := 24; i < 28; i++ {
		events = append(events, event{User: i, At: time.Unix(g.users[i].CreatedAt, 0).Add(time.Hour), Cash: 20, Credit: 20, Coupon: true, State: "success"})
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].At.Before(events[j].At) })
	for i, e := range events {
		g.order(i+1, e)
	}
	for _, u := range g.users {
		var earliest int64
		must(g.db.Model(&model.CampusPayment{}).Where("user_id = ? AND settled_at > 0", u.Id).Select("COALESCE(MIN(settled_at),0)").Scan(&earliest).Error)
		must(g.db.Model(&model.CampusMember{}).Where("user_id = ?", u.Id).Update("first_paid_at", earliest).Error)
		var subscriptions []model.UserSubscription
		must(g.db.Where("user_id = ?", u.Id).Find(&subscriptions).Error)
		for _, sub := range subscriptions {
			plan, err := model.GetSubscriptionPlanById(sub.PlanId)
			must(err)
			if plan.QuotaResetPeriod != "custom" || plan.QuotaResetCustomSeconds != 604800 {
				panic("review fixture for changed subscription reset rules")
			}
			// Simulate the intervening weekly resets without touching existing subscriptions.
			period := int64(plan.QuotaResetCustomSeconds)
			last := sub.StartTime + (now.Unix()-sub.StartTime)/period*period
			must(g.db.Model(&sub).Updates(map[string]any{"last_reset_time": last, "next_reset_time": last + period, "updated_at": max(sub.UpdatedAt, last)}).Error)
		}
	}
	_, err = model.CampusGetOverview(1)
	must(err)
	for i, spec := range []struct {
		state  string
		amount cp.Money
		day    int
	}{{"paid", 30000, 22}, {"rejected", 15000, 23}, {"failed", 15000, 23}, {"unknown", 20000, 23}, {"approved", 15000, 24}, {"paused", 12000, 27}, {"pending", 20000, 31}} {
		g.withdrawal(i+1, spec.state, spec.amount, g.start.AddDate(0, 0, spec.day).Add(5*time.Hour))
	}
	// Keep the simulation marker on every new ledger row without changing kinds.
	must(g.db.Model(&model.CampusEntry{}).Where("id > ?", g.initialEntry).Update("reason", gorm.Expr("reason || ?", " [本地模拟 "+batch+"]")).Error)
	must(g.db.Create(&model.CampusEntry{UserID: 1, ActorID: 1, Kind: "simulation_created", CreatedAt: now.Unix(), Reason: "用户授权建立本地模拟数据；历史活动起点与事件时间均为模拟；批次 " + batch}).Error)
	overview, err := model.CampusGetOverview(1)
	must(err)
	var counts []struct {
		State string
		Count int64
	}
	must(g.db.Model(&model.CampusWithdrawal{}).Select("state,COUNT(*) AS count").Group("state").Scan(&counts).Error)
	manifest := map[string]any{"batch": batch, "owner_user_id": 1, "simulated": true, "generated_at": now.Format(time.RFC3339), "new_users": len(g.users), "direct_invites": 24, "indirect_invites": 4, "orders": g.orders, "withdrawals": counts, "overview": overview}
	encoded, err := common.Marshal(manifest)
	must(err)
	must(os.WriteFile(filepath.Join(filepath.Dir(stagingPath), "dataset-manifest.json"), encoded, 0600))
	fmt.Printf("Staged synthetic dataset: %d users, %d orders, 7 withdrawals; owner performance %s, commission %s, frozen %s, available %s, processing %s, paid %s.\n", len(g.users), len(g.orders), overview.Member.Performance.String(), overview.Net.String(), overview.Frozen.String(), overview.Available.String(), overview.Processing.String(), overview.Paid.String())
}

func (g *generator) order(index int, e event) {
	u := g.users[e.User]
	trade := fmt.Sprintf("USR%dNO%s-%03d", u.Id, batch, index)
	if e.Plan != 0 {
		trade = "SUB" + trade
	}
	reference := fmt.Sprintf("SIM-%s-PAY-%03d", batch, index)
	var logBefore int
	must(g.db.Model(&model.Log{}).Select("COALESCE(MAX(id),0)").Scan(&logBefore).Error)
	var money float64
	var subscriptionID int
	if e.Plan == 0 {
		row := model.TopUp{UserId: u.Id, Amount: e.Credit, Money: float64(e.Cash), TradeNo: trade, PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, CreateTime: e.At.Add(-2 * time.Minute).Unix(), Status: common.TopUpStatusPending}
		must(model.InsertCampusTopUp(&row, true, "CNY", e.Coupon))
		money = row.Money
	} else {
		plan, err := model.GetSubscriptionPlanById(e.Plan)
		must(err)
		if !plan.Enabled {
			panic("simulation plan must match an enabled local plan")
		}
		row := model.SubscriptionOrder{UserId: u.Id, PlanId: e.Plan, Money: plan.PriceAmount, TradeNo: trade, PaymentMethod: "alipay", PaymentProvider: model.PaymentProviderEpay, CreateTime: e.At.Add(-2 * time.Minute).Unix(), Status: common.TopUpStatusPending}
		if e.Renew {
			var sub model.UserSubscription
			must(g.db.Where("user_id = ? AND plan_id = ?", u.Id, e.Plan).First(&sub).Error)
			row.RenewalSubscriptionId = sub.Id
		}
		must(model.InsertCampusSubscription(&row, true, "CNY"))
		money = row.Money
	}
	if e.State == "success" {
		params := epay.GenerateParams(map[string]string{"pid": operation_setting.EpayId, "out_trade_no": trade, "trade_no": reference, "trade_status": epay.StatusTradeSuccess, "type": "alipay", "money": fmt.Sprintf("%.2f", money), "sign_type": "MD5"}, operation_setting.EpayKey)
		values := url.Values{}
		for k, v := range params {
			values.Set(k, v)
		}
		response := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(response)
		ctx.Request = httptest.NewRequest(http.MethodPost, "http://127.0.0.1/simulation/callback", strings.NewReader(values.Encode()))
		ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		if e.Plan == 0 {
			controller.EpayNotify(ctx)
		} else {
			controller.SubscriptionEpayNotify(ctx)
		}
		if response.Body.String() != "success" {
			panic("simulated signed callback failed for " + trade)
		}
		must(g.db.Model(&model.TopUp{}).Where("trade_no = ?", trade).Update("complete_time", e.At.Unix()).Error)
		must(g.db.Model(&model.CampusPayment{}).Where("trade_no = ?", trade).Update("settled_at", e.At.Unix()).Error)
		var p model.CampusPayment
		must(g.db.Where("trade_no = ?", trade).First(&p).Error)
		must(g.db.Model(&model.CampusEntry{}).Where("payment_id = ?", p.ID).Update("created_at", e.At.Unix()).Error)
		if e.Plan != 0 {
			must(g.db.Model(&model.SubscriptionOrder{}).Where("trade_no = ?", trade).Update("complete_time", e.At.Unix()).Error)
			var sub model.UserSubscription
			must(g.db.Where("user_id = ? AND plan_id = ?", u.Id, e.Plan).First(&sub).Error)
			subscriptionID = sub.Id
			if !e.Renew {
				start := e.At
				must(g.db.Model(&sub).Updates(map[string]any{"start_time": start.Unix(), "end_time": start.AddDate(0, 1, 0).Unix(), "created_at": start.Unix(), "updated_at": start.Unix(), "last_reset_time": start.Unix(), "next_reset_time": start.Add(7 * 24 * time.Hour).Unix()}).Error)
				var windows []model.UserSubscriptionQuotaWindow
				must(g.db.Where("user_subscription_id = ?", sub.Id).Find(&windows).Error)
				for _, window := range windows {
					if window.PeriodUnit != "month" || window.PeriodValue != 1 {
						panic("review fixture for changed additional quota windows")
					}
					must(g.db.Model(&window).Updates(map[string]any{"window_start": start.Unix(), "next_reset_time": start.AddDate(0, 1, 0).Unix(), "created_at": start.Unix(), "updated_at": start.Unix()}).Error)
				}
			} else {
				must(g.db.Model(&sub).Update("updated_at", e.At.Unix()).Error)
			}
		}
		var logs []model.Log
		must(g.db.Where("id > ? AND user_id = ?", logBefore, u.Id).Find(&logs).Error)
		for _, log := range logs {
			other := map[string]any{}
			if log.Other != "" {
				must(common.UnmarshalJsonStr(log.Other, &other))
			}
			other["simulation_batch"], other["trade_no"], other["provider_transaction"] = batch, trade, reference
			encoded, err := common.Marshal(other)
			must(err)
			must(g.db.Model(&log).Updates(map[string]any{"created_at": e.At.Unix(), "other": string(encoded)}).Error)
		}
	} else if e.State == "failed" {
		must(model.CampusConfirmClosedOrder(trade, 1, "本地模拟：Epay 未付款订单关闭核对，批次 "+batch))
		must(g.db.Model(&model.CampusEntry{}).Where("user_id = ? AND kind = ?", u.Id, "payment_closed").Update("created_at", e.At.Unix()).Error)
	}
	g.orders = append(g.orders, map[string]any{"trade_no": trade, "user_id": u.Id, "plan_id": e.Plan, "subscription_id": subscriptionID, "renewal": e.Renew, "state": e.State, "amount_cny": money, "credit_units": e.Credit, "coupon": e.Coupon, "timestamp": e.At.Format(time.RFC3339), "simulated_provider_reference": reference})
}

func (g *generator) withdrawal(index int, state string, amount cp.Money, at time.Time) {
	w, err := model.CampusRequestWithdrawal(1, fmt.Sprintf("%s-WITHDRAW-%02d", batch, index), "campus-preview@example.test", "模拟收款人", amount)
	must(err)
	batchDate, err := cp.PayoutBatch(at)
	must(err)
	must(g.db.Model(w).Updates(map[string]any{"created_at": at.Unix(), "updated_at": at.Unix(), "batch": batchDate.Format(time.DateOnly)}).Error)
	must(g.db.Model(&model.CampusEntry{}).Where("withdrawal_id = ?", w.ID).Update("created_at", at.Unix()).Error)
	if state == "pending" {
		return
	}
	action := "approve"
	if state == "rejected" {
		action = "reject"
	}
	if state == "failed" {
		action = "failed"
	}
	if state == "paused" {
		action = "pause"
	}
	must(model.CampusActWithdrawal(w.ID, 1, action, "本地模拟：收款资料审核记录 "+batch, "", 0))
	must(g.db.Model(&model.CampusEntry{}).Where("withdrawal_id = ? AND kind <> ?", w.ID, "withdrawal_requested").Update("created_at", at.Add(time.Hour).Unix()).Error)
	updated := at.Add(time.Hour)
	if state == "paid" || state == "unknown" {
		paidAt := time.Date(2026, 10, 31, 15, 30, 0, 0, g.now.Location())
		if state == "paid" {
			must(model.CampusActWithdrawal(w.ID, 1, "paid", "本地模拟转账登记，未发生真实资金转移", fmt.Sprintf("SIM-%s-PAYOUT-%02d", batch, index), paidAt.Unix()))
		} else {
			must(model.CampusActWithdrawal(w.ID, 1, "unknown", "本地模拟：转账结果待人工核对", "", 0))
		}
		must(g.db.Model(&model.CampusEntry{}).Where("withdrawal_id = ? AND kind = ?", w.ID, "withdrawal_"+state).Update("created_at", paidAt.Unix()).Error)
		updated = paidAt
	}
	must(g.db.Model(w).Update("updated_at", updated.Unix()).Error)
}
