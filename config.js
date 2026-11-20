// Clés publiques de WeeCert (voir README.md).
// La clé Supabase "anon" est publique par conception : ce sont les règles d'accès (supabase/schema.sql)
// qui protègent les données. Seuls les membres de la liste de l'équipe peuvent lire les questions et le classement.
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";
// false : WeeCert n'envoie aucun e-mail (inscription sans lien de confirmation, mot de passe réinitialisé par l'administrateur).
// Passer à true après avoir configuré un service d'envoi (SMTP) dans Supabase et réactivé « Confirm email ».
export const EMAILS = false;
