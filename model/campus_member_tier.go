package model

import (
	"database/sql"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
)

type CampusMemberTier struct {
	Joined         bool          `json:"joined"`
	Override       int           `json:"override"`
	Revision       int64         `json:"revision"`
	ConfigRevision int64         `json:"config_revision"`
	Performance    cp.Money      `json:"performance_cents"`
	Automatic      cp.Tier       `json:"automatic"`
	Effective      cp.Tier       `json:"effective"`
	Tiers          []cp.TierRule `json:"tiers"`
}

func CampusGetMemberTier(userID int) (CampusMemberTier, error) {
	var result CampusMemberTier
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := tx.Select("id").First(&user, userID).Error; err != nil {
			return err
		}
		var config CampusCampaign
		if err := tx.First(&config, 1).Error; err != nil {
			return err
		}
		var err error
		result.Tiers, err = config.CommissionTiers()
		if err != nil {
			return err
		}
		result.ConfigRevision = config.TierRevision
		var member CampusMember
		err = tx.First(&member, "user_id = ?", userID).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		result.Joined = member.JoinedAt > 0
		result.Override, result.Revision, result.Performance = member.TierOverride, member.TierRevision, member.Performance
		result.Automatic, err = cp.CurrentTier(member.Performance, result.Tiers)
		if err != nil {
			return err
		}
		result.Effective, err = cp.EffectiveTier(member.Performance, member.TierOverride, result.Tiers)
		if err != nil {
			return err
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func CampusSetMemberTier(userID, level int, expectedRevision, configRevision int64, enroll bool) error {
	if userID <= 0 || level < 0 || expectedRevision < 0 || configRevision < 0 {
		return common.NewMessage("Invalid parameters")
	}
	return campusTransaction(DB, func(tx *gorm.DB) error {
		config, err := campusReadConfig(tx)
		if err != nil {
			return err
		}
		if config.TierRevision != configRevision {
			return ErrCampusState
		}
		tiers, err := config.CommissionTiers()
		if err != nil {
			return err
		}
		if level > len(tiers) {
			return common.NewMessage("Invalid commission tiers")
		}
		var user User
		if err := tx.Select("id").First(&user, userID).Error; err != nil {
			return err
		}
		member, err := campusMember(tx, userID)
		if err != nil {
			return err
		}
		joining := member.JoinedAt == 0
		if joining && !enroll {
			return common.NewMessage("This user has not joined the partner program")
		}
		if !joining && enroll {
			return ErrCampusState
		}
		if member.TierRevision != expectedRevision {
			return ErrCampusState
		}
		if !joining && member.TierOverride == level {
			return nil
		}
		if joining {
			member.JoinedAt = time.Now().Unix()
			// Do not record reminder acceptance on behalf of the user.
		}
		member.TierOverride, member.TierRevision = level, member.TierRevision+1
		return tx.Save(member).Error
	})
}
