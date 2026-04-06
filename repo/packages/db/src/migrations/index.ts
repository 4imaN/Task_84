import type { VersionedMigration } from '../index';
import { initialSchemaMigration } from './001_initial_schema';
import { reconciliationAndCheckoutMigration } from './002_reconciliation_and_checkout';
import { userIdentifierEncryptionMigration } from './003_user_identifier_encryption';
import { appendOnlySecurityMigration } from './004_append_only_security';
import { reconciliationWorkflowCleanupMigration } from './005_reconciliation_workflow_cleanup';
import { runtimeRoleHardeningMigration } from './006_runtime_role_hardening';
import { ruleVersionsUniquenessMigration } from './007_rule_versions_uniqueness';
import { communitySelfRelationshipConstraintsMigration } from './008_community_self_relationship_constraints';
import { runtimeRoleLeastPrivilegeMigration } from './009_runtime_role_least_privilege';
import { domainConstraintsAndUserUpdateGrantsMigration } from './010_domain_constraints_and_user_update_grants';
import { chainSignaturesMigration } from './011_chain_signatures';
import { attendanceAuthoritativeTimestampMigration } from './012_attendance_authoritative_timestamp';

export const versionedMigrations: VersionedMigration[] = [
  initialSchemaMigration,
  reconciliationAndCheckoutMigration,
  userIdentifierEncryptionMigration,
  appendOnlySecurityMigration,
  reconciliationWorkflowCleanupMigration,
  runtimeRoleHardeningMigration,
  ruleVersionsUniquenessMigration,
  communitySelfRelationshipConstraintsMigration,
  runtimeRoleLeastPrivilegeMigration,
  domainConstraintsAndUserUpdateGrantsMigration,
  chainSignaturesMigration,
  attendanceAuthoritativeTimestampMigration,
];
