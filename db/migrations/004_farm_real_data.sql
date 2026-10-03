-- 小薯实时农场 (farm/): demo plots by default; an admin turns on real plots/sensors/cameras per account.
ALTER TABLE users ADD COLUMN farm_real_data boolean NOT NULL DEFAULT false;
