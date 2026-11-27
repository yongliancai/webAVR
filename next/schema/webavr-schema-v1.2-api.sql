-- Local API prototype only; apply after base v1 and v1.1 in an isolated DB.
BEGIN;
CREATE TABLE auth_private.activation_approvals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES webavr.users(id) ON DELETE RESTRICT,
  approved_by uuid NOT NULL REFERENCES webavr.users(id) ON DELETE RESTRICT,
  evidence_ref text NOT NULL CHECK(length(trim(evidence_ref)) BETWEEN 3 AND 300),
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activation_approvals_user ON auth_private.activation_approvals(user_id);
CREATE TABLE migration_private.archive_reviews (
  id uuid PRIMARY KEY,
  revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  archive_id uuid NOT NULL REFERENCES migration_private.archives(id) ON DELETE RESTRICT,
  subject_user_id uuid NOT NULL REFERENCES webavr.users(id) ON DELETE RESTRICT,
  course_id uuid REFERENCES webavr.courses(id) ON DELETE RESTRICT,
  class_id uuid REFERENCES webavr.classes(id) ON DELETE RESTRICT,
  occurred_at timestamptz,
  scope text NOT NULL CHECK(scope IN ('private','learning')),
  decision text NOT NULL CHECK(decision IN ('verified','withheld')),
  reviewed_by uuid NOT NULL REFERENCES webavr.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
  request_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reviewed_by,request_id),
  CHECK((scope='private' AND course_id IS NULL AND class_id IS NULL AND occurred_at IS NULL)
    OR (scope='learning' AND course_id IS NOT NULL AND class_id IS NOT NULL AND occurred_at IS NOT NULL))
);
CREATE INDEX archive_reviews_latest ON migration_private.archive_reviews(archive_id,revision DESC);
CREATE TRIGGER archive_reviews_immutable BEFORE UPDATE OR DELETE ON migration_private.archive_reviews
  FOR EACH ROW EXECUTE FUNCTION webavr.reject_history_mutation();
CREATE TRIGGER activation_approvals_immutable BEFORE UPDATE OR DELETE ON auth_private.activation_approvals
  FOR EACH ROW EXECUTE FUNCTION webavr.reject_history_mutation();
INSERT INTO webavr.schema_versions(version) VALUES ('v1.2-local-auth-api');
COMMIT;
