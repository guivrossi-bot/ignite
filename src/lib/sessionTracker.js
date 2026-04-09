import { supabase } from './supabaseClient';

export function generateSessionId() {
  return crypto.randomUUID();
}

export async function trackReachedReport(sessionId, { apps, calcData, lang, unit }) {
  if (!supabase) return;
  try {
    await supabase.from('calc_sessions').upsert([{
      session_id: sessionId,
      source: 'ignite',
      apps_selected: apps,
      calc_data: calcData,
      lang,
      unit,
      reached_report: true,
    }], { onConflict: 'session_id' });
  } catch (e) {
    console.warn('trackReachedReport', e);
  }
}

export async function trackSentLead(sessionId) {
  if (!supabase) return;
  try {
    await supabase.from('calc_sessions')
      .update({ sent_lead: true, updated_at: new Date().toISOString() })
      .eq('session_id', sessionId);
  } catch (e) {
    console.warn('trackSentLead', e);
  }
}
