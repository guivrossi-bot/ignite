import { supabase } from './supabaseClient';

export function generateSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export async function trackReachedReport(sessionId, { apps, calcData, lang, unit }) {
  if (!supabase) { console.warn('[tracker] supabase client is null'); return; }
  const { error } = await supabase.from('calc_sessions').upsert([{
    session_id: sessionId,
    source: 'ignite',
    apps_selected: apps,
    calc_data: calcData,
    lang,
    unit,
    reached_report: true,
  }], { onConflict: 'session_id' });
  if (error) console.warn('[tracker] trackReachedReport error:', error);
  else console.log('[tracker] trackReachedReport ok', sessionId);
}

export async function trackSentLead(sessionId) {
  if (!supabase) { console.warn('[tracker] supabase client is null'); return; }
  const { error } = await supabase.from('calc_sessions')
    .update({ sent_lead: true, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId);
  if (error) console.warn('[tracker] trackSentLead error:', error);
  else console.log('[tracker] trackSentLead ok', sessionId);
}
