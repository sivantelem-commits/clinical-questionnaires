import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
export const SUPABASE_URL = 'https://bbmjhpkukwyhlfuhcncg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Wg-B3qan5Z7RQj3rpdWFbQ_TJMPOXO8';
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true } });
export const SAFETY_HTML = `
  <strong>אם את/ה במצוקה עכשיו – אין צורך לחכות לפגישה.</strong><br>
  ער"ן – עזרה ראשונה נפשית: <a href="tel:1201">1201</a> (24/7) ·
  סה"ר – סיוע והקשבה ברשת: <a href="https://sahar.org.il" target="_blank" rel="noopener">sahar.org.il</a> ·
  במצב חירום: מד"א <a href="tel:101">101</a> או חדר מיון.<br>
  <small>התשובות שלך יגיעו למטפל/ת, אך הטופס אינו מנוטר בזמן אמת.</small>`;
