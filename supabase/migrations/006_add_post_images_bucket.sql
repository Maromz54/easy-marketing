-- Migration 006: Create public storage bucket for post images.
-- RLS policies let authenticated users upload to their own sub-folder
-- and allow anyone (including the Chrome extension) to read files.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post_images',
  'post_images',
  true,
  5242880,  -- 5 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = 5242880,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

-- Authenticated users may upload only into their own folder ({user_id}/*)
CREATE POLICY "Users can upload own images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'post_images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read — needed so the Chrome extension can fetch the image URL
CREATE POLICY "Public read for post images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'post_images');

-- Users can delete their own files
CREATE POLICY "Users can delete own images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'post_images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
