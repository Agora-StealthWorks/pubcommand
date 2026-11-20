-- Launch funnels: parity with the old Launch Funnels app (additive only).

ALTER TABLE "funnels"
  ADD COLUMN IF NOT EXISTS "lock_first_module" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "between_sessions" TEXT NOT NULL DEFAULT 'hybrid',
  ADD COLUMN IF NOT EXISTS "live_countdown" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "live_countdown_title" TEXT NOT NULL DEFAULT 'We go live in…',
  ADD COLUMN IF NOT EXISTS "today_training_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "today_training_text" TEXT NOT NULL DEFAULT 'Join today''s session',
  ADD COLUMN IF NOT EXISTS "today_training_msg" TEXT NOT NULL DEFAULT 'Today''s live session, {day}, starts at {time}.',
  ADD COLUMN IF NOT EXISTS "today_training_live_msg" TEXT NOT NULL DEFAULT 'Today''s live session, {day}, is live right now!',
  ADD COLUMN IF NOT EXISTS "unlock_countdown_mode" TEXT NOT NULL DEFAULT 'day_of',
  ADD COLUMN IF NOT EXISTS "unlock_countdown_title" TEXT NOT NULL DEFAULT 'Unlocks in…',
  ADD COLUMN IF NOT EXISTS "early_join_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "early_join_minutes" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "early_join_text" TEXT NOT NULL DEFAULT 'Join the room early',
  ADD COLUMN IF NOT EXISTS "early_join_url" TEXT,
  ADD COLUMN IF NOT EXISTS "prev_button_text" TEXT NOT NULL DEFAULT 'Watch the previous day',
  ADD COLUMN IF NOT EXISTS "calendar_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "calendar_button_text" TEXT NOT NULL DEFAULT 'Add to calendar',
  ADD COLUMN IF NOT EXISTS "calendar_mode" TEXT NOT NULL DEFAULT 'builtin',
  ADD COLUMN IF NOT EXISTS "calendar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "cal_invite_title" TEXT NOT NULL DEFAULT '{funnel}: {title}',
  ADD COLUMN IF NOT EXISTS "cal_invite_desc" TEXT NOT NULL DEFAULT E'You''re registered! Join the livestream here:\n{room_url}\n\n{title} goes live {date}.',
  ADD COLUMN IF NOT EXISTS "cal_reminders" TEXT NOT NULL DEFAULT '1440,60,15',
  ADD COLUMN IF NOT EXISTS "cal_invite_scope" TEXT NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS "waitlist_bg" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "waitlist_text" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "waitlist_bg_image_url" TEXT,
  ADD COLUMN IF NOT EXISTS "countdown_box_bg" TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS "countdown_digit" TEXT NOT NULL DEFAULT '#111827',
  ADD COLUMN IF NOT EXISTS "homework_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "homework_title" TEXT NOT NULL DEFAULT 'Pre-event homework',
  ADD COLUMN IF NOT EXISTS "homework_subtitle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "homework_items" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "hosts_bg" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "hosts_title_color" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "agenda_layout" TEXT NOT NULL DEFAULT 'list',
  ADD COLUMN IF NOT EXISTS "agenda_bg" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "agenda_text" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "livendar_title" TEXT NOT NULL DEFAULT 'Add this event to your calendar',
  ADD COLUMN IF NOT EXISTS "livendar_html" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "deadline_bar_digit_color" TEXT,
  ADD COLUMN IF NOT EXISTS "deadline_bar_button_bg" TEXT,
  ADD COLUMN IF NOT EXISTS "deadline_bar_spacing" TEXT NOT NULL DEFAULT 'narrow';

ALTER TABLE "funnel_days"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'video',
  ADD COLUMN IF NOT EXISTS "locked_message" TEXT,
  ADD COLUMN IF NOT EXISTS "calendar_url" TEXT,
  ADD COLUMN IF NOT EXISTS "show_agenda" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "agenda_scope" TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS "livendar_mode" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS "livendar_html" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "cta_bg" TEXT,
  ADD COLUMN IF NOT EXISTS "cta_text_color" TEXT,
  ADD COLUMN IF NOT EXISTS "cta_new_tab" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "funnel_nav_items"
  ADD COLUMN IF NOT EXISTS "is_home" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "agenda_title" TEXT NOT NULL DEFAULT '';

ALTER TABLE "funnel_events"
  ADD COLUMN IF NOT EXISTS "page" TEXT,
  ADD COLUMN IF NOT EXISTS "target" TEXT,
  ADD COLUMN IF NOT EXISTS "device" TEXT;

CREATE INDEX IF NOT EXISTS "funnel_events_organization_id_funnel_id_kind_idx" ON "funnel_events" ("organization_id", "funnel_id", "kind");
