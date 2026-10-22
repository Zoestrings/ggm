-- ==============================================================================
-- In-App Update Checker Table: app_versions
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version TEXT NOT NULL,
    download_url TEXT NOT NULL,
    release_notes TEXT,
    is_mandatory BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated and anonymous members to read app_versions
CREATE POLICY "Allow public read access to app_versions"
    ON public.app_versions
    FOR SELECT
    USING (true);

-- Only super_admins can insert or update versions
CREATE POLICY "Allow super_admins to manage app_versions"
    ON public.app_versions
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role = 'super_admin'
        )
    );

-- Index for speedy ordering by newest version
CREATE INDEX IF NOT EXISTS idx_app_versions_created_at ON public.app_versions (created_at DESC);

-- ==============================================================================
-- Sample / Test Insert:
-- Uncomment and run the query below in Supabase SQL editor to test the update popup!
-- ==============================================================================
-- INSERT INTO public.app_versions (version, download_url, release_notes, is_mandatory)
-- VALUES (
--     '2.0.0',
--     'https://expo.dev',
--     'New security upgrades, live password strength indicators, and Nigerian phone validation!',
--     false
-- );
