-- Make the external-assignment check bidirectional:
-- internal rows must have a technician profile and no external details.
ALTER TABLE assignments DROP CONSTRAINT assignments_external_check;

ALTER TABLE assignments
  ADD CONSTRAINT assignments_external_check CHECK (
    (
      is_external = true
      AND external_name IS NOT NULL
      AND external_phone IS NOT NULL
      AND technician_profile_id IS NULL
    ) OR (
      is_external = false
      AND technician_profile_id IS NOT NULL
      AND external_name IS NULL
      AND external_phone IS NULL
    )
  );
