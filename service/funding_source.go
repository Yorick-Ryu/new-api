package service

import (
	"errors"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

// ---------------------------------------------------------------------------
// FundingSource — 资金来源接口（钱包 or 订阅）
// ---------------------------------------------------------------------------

// FundingSource 抽象了预扣费的资金来源。
type FundingSource interface {
	// Source 返回资金来源标识："wallet" 或 "subscription"
	Source() string
	// PreConsume 从该资金来源预扣 amount 额度
	PreConsume(amount int) error
	// Settle 根据差额调整资金来源（正数补扣，负数退还）
	Settle(delta int) error
	// Refund 退还所有预扣费
	Refund() error
}

// ---------------------------------------------------------------------------
// WalletFunding — 钱包资金来源实现
// ---------------------------------------------------------------------------

type WalletFunding struct {
	userId   int
	consumed int // 实际预扣的用户额度
}

func (w *WalletFunding) Source() string { return BillingSourceWallet }

func (w *WalletFunding) PreConsume(amount int) error {
	if amount <= 0 {
		return nil
	}
	if err := model.DecreaseUserQuota(w.userId, amount, false); err != nil {
		return err
	}
	w.consumed = amount
	return nil
}

func (w *WalletFunding) Settle(delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return model.DecreaseUserQuota(w.userId, delta, false)
	}
	return model.IncreaseUserQuota(w.userId, -delta, false)
}

func (w *WalletFunding) Refund() error {
	if w.consumed <= 0 {
		return nil
	}
	// IncreaseUserQuota 是 quota += N 的非幂等操作，不能重试，否则会多退额度。
	// 订阅的 RefundSubscriptionPreConsume 有 requestId 幂等保护所以可以重试。
	return model.IncreaseUserQuota(w.userId, w.consumed, false)
}

// ---------------------------------------------------------------------------
// SubscriptionFunding — 订阅资金来源实现
// ---------------------------------------------------------------------------

type SubscriptionFunding struct {
	requestId       string
	userId          int
	modelName       string
	amount          int64 // 预扣的订阅额度（subConsume）
	subscriptionId  int
	preConsumed     int64 // Full reservation in subscription units
	baseConsumed    int64 // Normal model charge before the subscription multiplier
	consumed        int64 // Current subscription charge after the multiplier
	ModelMultiplier float64
	GroupRatio      float64
	relayInfo       *relaycommon.RelayInfo
	// 以下字段在 PreConsume 成功后填充，供 RelayInfo 同步使用
	AmountTotal     int64
	AmountUsedAfter int64
	PlanId          int
	PlanTitle       string
}

func (s *SubscriptionFunding) Source() string { return BillingSourceSubscription }

func (s *SubscriptionFunding) PreConsume(_ int) error {
	// amount 参数被忽略，使用内部 s.amount（已在构造时根据 preConsumedQuota 计算）
	res, err := model.PreConsumeUserSubscription(s.requestId, s.userId, s.modelName, 0, s.amount, func(ratio float64) (int64, error) {
		return subscriptionPreConsumeQuota(s.relayInfo, s.amount, ratio)
	})
	if err != nil {
		return err
	}
	s.subscriptionId = res.UserSubscriptionId
	s.preConsumed = res.PreConsumed
	s.baseConsumed = s.amount
	if res.GroupRatio > 0 {
		s.baseConsumed = res.PreConsumed
	}
	s.consumed = res.PreConsumed
	s.ModelMultiplier = res.ModelMultiplier
	s.GroupRatio = res.GroupRatio
	s.AmountTotal = res.AmountTotal
	s.AmountUsedAfter = res.AmountUsedAfter
	// 获取订阅计划信息
	if planInfo, err := model.GetSubscriptionPlanInfoByUserSubscriptionId(res.UserSubscriptionId); err == nil && planInfo != nil {
		s.PlanId = planInfo.PlanId
		s.PlanTitle = planInfo.PlanTitle
	}
	return nil
}

// subscriptionPreConsumeQuota replaces the group ratio on the unrounded model
// estimate. It never divides a rounded charge in normal request paths.
func subscriptionPreConsumeQuota(info *relaycommon.RelayInfo, normalQuota int64, ratio float64) (int64, error) {
	if info == nil || math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0.001 || ratio > 1000 {
		return 0, errors.New("invalid subscription group ratio")
	}
	var base float64
	if info.TieredBillingSnapshot != nil {
		base = info.TieredBillingSnapshot.EstimatedQuotaBeforeGroup
	} else if info.PriceData.QuotaBeforeGroup != nil {
		base = info.PriceData.ApplyOtherRatiosToFloat(*info.PriceData.QuotaBeforeGroup)
	} else {
		// Compatibility for callers that only supply a quota estimate.
		groupRatio := info.PriceData.GroupRatioInfo.GroupRatio
		if groupRatio <= 0 || math.IsNaN(groupRatio) || math.IsInf(groupRatio, 0) {
			return 0, errors.New("subscription pricing requires a quota estimate before the group ratio")
		}
		base = float64(normalQuota) / groupRatio
	}
	if base < 0 {
		return 0, errors.New("negative subscription quota estimate")
	}
	var quota int
	var err error
	if info.TieredBillingSnapshot != nil {
		quota, err = common.QuotaRoundStrict(base * ratio)
	} else {
		quota, err = common.QuotaFromFloatStrict(base * ratio)
	}
	if err != nil {
		return 0, err
	}
	// Even a zero estimate needs a reservation record; settlement refunds it
	// when actual usage is zero.
	return int64(max(quota, 1)), nil
}

func (s *SubscriptionFunding) Settle(delta int) error {
	targetBase := s.baseConsumed + int64(delta)
	target, err := model.SubscriptionQuotaWithMultiplier(targetBase, s.ModelMultiplier)
	if err != nil {
		return err
	}
	if err := model.PostConsumeUserSubscriptionDelta(s.subscriptionId, target-s.consumed); err != nil {
		return err
	}
	s.baseConsumed = targetBase
	s.consumed = target
	return nil
}

func (s *SubscriptionFunding) Reserve(delta int) error {
	targetBase := s.baseConsumed + int64(delta)
	target, err := model.SubscriptionQuotaWithMultiplier(targetBase, s.ModelMultiplier)
	if err != nil {
		return err
	}
	if err := model.UpdateSubscriptionPreConsumeAmount(s.requestId, target); err != nil {
		return err
	}
	s.AmountUsedAfter += target - s.consumed
	s.baseConsumed = targetBase
	s.consumed = target
	s.preConsumed = target
	return nil
}

func (s *SubscriptionFunding) Refund() error {
	if s.preConsumed <= 0 {
		return nil
	}
	return refundWithRetry(func() error {
		return model.RefundSubscriptionPreConsume(s.requestId)
	})
}

// refundWithRetry 尝试多次执行退款操作以提高成功率，只能用于基于事务的退款函数！！！！！！
// try to refund with retries, only for refund functions based on transactions!!!
func refundWithRetry(fn func() error) error {
	if fn == nil {
		return nil
	}
	const maxAttempts = 3
	var lastErr error
	for i := 0; i < maxAttempts; i++ {
		if err := fn(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if i < maxAttempts-1 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return lastErr
}
