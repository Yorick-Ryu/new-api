package model

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const businessActivityDaySeconds = 86400

// A row covers one complete Beijing day, including days with no active users.
// The user IDs preserve deduplication across days and partial-day log queries.
type businessActivityDay struct {
	DayStart int64  `gorm:"primaryKey;autoIncrement:false"`
	UserIDs  string `gorm:"not null"`
	Revision int64  `gorm:"not null"`
}

// DayStart zero is never a Beijing midnight. Its revision prevents a summary
// read before usage-log deletion from being published after that deletion.
const businessActivityLockDay = 0

var businessActivityDaysDB *gorm.DB

func initBusinessActivityDays() error {
	businessActivityDaysDB = nil
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		return nil
	}
	if common.IsMasterNode {
		if err := migrateBusinessActivityDays(LOG_DB); err != nil {
			return fmt.Errorf("initialize business activity days: %w", err)
		}
	}
	if LOG_DB.Migrator().HasTable(&businessActivityDay{}) {
		businessActivityDaysDB = LOG_DB
	}
	return nil
}

func migrateBusinessActivityDays(db *gorm.DB) error {
	if err := db.AutoMigrate(&businessActivityDay{}); err != nil {
		return err
	}
	return db.Clauses(clause.OnConflict{DoNothing: true}).Create(&businessActivityDay{
		DayStart: businessActivityLockDay,
		UserIDs:  "[]",
	}).Error
}

func businessActivityDayStart(timestamp int64) int64 {
	const beijingOffset = 8 * time.Hour
	return time.Unix(timestamp, 0).Add(beijingOffset).Truncate(24 * time.Hour).Add(-beijingOffset).Unix()
}

func businessActivityLogs(db *gorm.DB) *gorm.DB {
	return db.Model(&Log{}).Where("type = ? AND user_id > 0", LogTypeConsume)
}

func getBusinessActivity(ctx context.Context, start, end, previousStart, previousEnd int64) (*BusinessActivity, error) {
	if LOG_DB == nil {
		return nil, nil
	}
	db := LOG_DB.WithContext(ctx)
	result := &BusinessActivity{}
	if LOG_DB != businessActivityDaysDB {
		current := businessActivityLogs(db).Where("created_at >= ? AND created_at < ?", start, end).
			Select("COUNT(DISTINCT user_id) AS users")
		previous := businessActivityLogs(db).Where("created_at >= ? AND created_at < ?", previousStart, previousEnd).
			Select("COUNT(DISTINCT user_id) AS users")
		err := db.Table("(?) AS current_activity, (?) AS previous_activity", current, previous).
			Select("current_activity.users, previous_activity.users AS previous_users").Scan(result).Error
		return result, err
	}

	// Read coverage and uncovered logs in the same snapshot, including when a
	// log-cleanup transaction invalidates a day while this request is running.
	err := db.Transaction(func(tx *gorm.DB) error {
		var days []businessActivityDay
		if err := tx.Where("(day_start >= ? AND day_start <= ?) OR (day_start >= ? AND day_start <= ?)",
			start, end-businessActivityDaySeconds, previousStart, previousEnd-businessActivityDaySeconds).
			Where("day_start <> ?", businessActivityLockDay).Order("day_start").Find(&days).Error; err != nil {
			return err
		}
		var err error
		result.Users, err = countBusinessActiveUsers(tx, start, end, days)
		if err != nil {
			return err
		}
		result.PreviousUsers, err = countBusinessActiveUsers(tx, previousStart, previousEnd, days)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

func countBusinessActiveUsers(db *gorm.DB, start, end int64, days []businessActivityDay) (int64, error) {
	users := make(map[int]struct{})
	var detailRanges *gorm.DB
	includeLogRange := func(start, end int64) {
		if start >= end {
			return
		}
		if detailRanges == nil {
			detailRanges = db.Where("(created_at >= ? AND created_at < ?)", start, end)
		} else {
			detailRanges = detailRanges.Or("(created_at >= ? AND created_at < ?)", start, end)
		}
	}
	detailStart := start
	for _, day := range days {
		if day.DayStart < start || day.DayStart+businessActivityDaySeconds > end {
			continue
		}
		includeLogRange(detailStart, day.DayStart)
		var dayUsers []int
		if err := common.UnmarshalJsonStr(day.UserIDs, &dayUsers); err != nil {
			return 0, fmt.Errorf("read business activity day %d: %w", day.DayStart, err)
		}
		for _, userID := range dayUsers {
			users[userID] = struct{}{}
		}
		detailStart = day.DayStart + businessActivityDaySeconds
	}
	includeLogRange(detailStart, end)
	if detailRanges != nil {
		var detailUsers []int
		if err := businessActivityLogs(db).Where(detailRanges).Distinct().Pluck("user_id", &detailUsers).Error; err != nil {
			return 0, err
		}
		for _, userID := range detailUsers {
			users[userID] = struct{}{}
		}
	}
	return int64(len(users)), nil
}

// RunBusinessActivityRollup warms recent complete days one at a time. Read the
// current day and very recently closed days from logs while writes settle.
func RunBusinessActivityRollup(ctx context.Context) {
	if !common.IsMasterNode || businessActivityDaysDB == nil {
		return
	}
	for ctx.Err() == nil {
		end := businessActivityDayStart(time.Now().Add(-time.Hour).Unix())
		// The longest preset compares two 90-day periods.
		const lookback = 180 * businessActivityDaySeconds
		scanCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		var existing []int64
		err := businessActivityDaysDB.WithContext(scanCtx).Model(&businessActivityDay{}).
			Where("day_start >= ? AND day_start < ?", end-lookback, end).Pluck("day_start", &existing).Error
		cancel()
		if err != nil {
			common.SysError("load business activity rollup coverage: " + err.Error())
		} else {
			covered := make(map[int64]struct{}, len(existing))
			for _, day := range existing {
				covered[day] = struct{}{}
			}
			for day := end - businessActivityDaySeconds; day >= end-lookback && ctx.Err() == nil; day -= businessActivityDaySeconds {
				if _, ok := covered[day]; ok {
					continue
				}
				buildCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
				err := summarizeBusinessActivityDay(businessActivityDaysDB.WithContext(buildCtx), day)
				cancel()
				if err != nil && ctx.Err() == nil {
					common.SysError(fmt.Sprintf("summarize business activity day %d: %v", day, err))
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(3 * time.Second):
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Minute):
		}
	}
}

func summarizeBusinessActivityDay(db *gorm.DB, day int64) error {
	var state businessActivityDay
	if err := db.Select("revision").Take(&state, "day_start = ?", businessActivityLockDay).Error; err != nil {
		return err
	}
	// Keep the log scan outside the write transaction so SQLite ingestion can
	// continue, and log cleanup can advance the revision while this scan runs.
	userIDs := make([]int, 0)
	if err := businessActivityLogs(db).Where("created_at >= ? AND created_at < ?", day, day+businessActivityDaySeconds).
		Distinct().Pluck("user_id", &userIDs).Error; err != nil {
		return err
	}
	encoded, err := common.Marshal(userIDs)
	if err != nil {
		return err
	}
	return db.Transaction(func(tx *gorm.DB) error {
		guard := tx.Model(&businessActivityDay{}).Where("day_start = ? AND revision = ?", businessActivityLockDay, state.Revision).
			UpdateColumn("revision", gorm.Expr("revision + 1"))
		if guard.Error != nil || guard.RowsAffected == 0 {
			return guard.Error
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&businessActivityDay{DayStart: day, UserIDs: string(encoded)}).Error
	})
}
