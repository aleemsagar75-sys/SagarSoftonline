-- Supabase SQL Editor me yeh query chalayein (Sirf ek baar)
-- Yeh RPC function create karega. Phir app aur web dashboard
-- apne aap table create kar lenge.

CREATE OR REPLACE FUNCTION create_tables()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TABLE IF NOT EXISTS sms_queue (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id TEXT NOT NULL,
    device_id TEXT,
    recipient_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'Manual SMS',
    campaign_type TEXT DEFAULT 'manual',
    recipient_name TEXT,
    recipient_type TEXT DEFAULT 'student',
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS sent_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id TEXT,
    device_id TEXT,
    recipient_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT,
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS devices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    school_id TEXT NOT NULL,
    device_name TEXT,
    device_id TEXT NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT false,
    sim_number TEXT,
    last_poll_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );
END;
$$;

-- Allow anon role to execute (for web dashboard)
GRANT EXECUTE ON FUNCTION create_tables TO anon;

-- Allow authenticated role to execute (for Android app)
GRANT EXECUTE ON FUNCTION create_tables TO authenticated;

-- Enable Row Level Security
ALTER TABLE sms_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- RLS Policies: allow anon (web dashboard) full access
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sms_queue_anon_all' AND tablename = 'sms_queue') THEN
    CREATE POLICY sms_queue_anon_all ON sms_queue FOR ALL TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'devices_anon_all' AND tablename = 'devices') THEN
    CREATE POLICY devices_anon_all ON devices FOR ALL TO anon USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sent_messages_anon_all' AND tablename = 'sent_messages') THEN
    CREATE POLICY sent_messages_anon_all ON sent_messages FOR ALL TO anon USING (true);
  END IF;
END $$;

-- RLS Policies: allow authenticated (Android agent) full access
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sms_queue_auth_all' AND tablename = 'sms_queue') THEN
    CREATE POLICY sms_queue_auth_all ON sms_queue FOR ALL TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'devices_auth_all' AND tablename = 'devices') THEN
    CREATE POLICY devices_auth_all ON devices FOR ALL TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sent_messages_auth_all' AND tablename = 'sent_messages') THEN
    CREATE POLICY sent_messages_auth_all ON sent_messages FOR ALL TO authenticated USING (true);
  END IF;
END $$;

-- Grants for anon role
GRANT ALL ON TABLE sms_queue TO anon;
GRANT ALL ON TABLE devices TO anon;
GRANT ALL ON TABLE sent_messages TO anon;

-- Grants for authenticated role
GRANT ALL ON TABLE sms_queue TO authenticated;
GRANT ALL ON TABLE devices TO authenticated;
GRANT ALL ON TABLE sent_messages TO authenticated;
