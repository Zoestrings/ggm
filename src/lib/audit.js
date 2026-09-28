import { supabase } from './supabase';

/**
 * Logs an administrative action to the audit_logs table.
 * @param {Object} params
 * @param {string} params.actorId User UUID performing the action
 * @param {string} params.action Action name (e.g. 'create_admin', 'revoke_admin', 'finalize_activity')
 * @param {string} params.entity Entity type ('users', 'activities', 'attendance')
 * @param {string} [params.entityId] UUID of affected record
 * @param {Object} [params.oldValue] Previous state
 * @param {Object} [params.newValue] New state
 * @param {string} [params.reason] Note or justification
 */
export async function logAudit({ actorId, action, entity, entityId, oldValue, newValue, reason }) {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: actorId,
      action: action,
      entity: entity,
      entity_id: entityId,
      old_value: oldValue || null,
      new_value: newValue || null,
      reason: reason || null,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.warn('Audit logging note:', error.message);
    }
  } catch (err) {
    console.warn('Audit logging error:', err);
  }
}
