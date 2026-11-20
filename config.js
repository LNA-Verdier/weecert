// Clés publiques de WeeCert (voir README.md).
// La clé Supabase "anon" est publique par conception : ce sont les règles d'accès (supabase/schema.sql)
// qui protègent les données. Seuls les membres de la liste de l'équipe peuvent lire les questions et le classement.
export const SUPABASE_URL = "https://qgctwspwhxlnsbyaphfo.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnY3R3c3B3aHhsbnNieWFwaGZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODE2MjEsImV4cCI6MjExMDc1NzYyMX0.S4dqVJhz6fHlGExapEtFqhEogIjGANbcK4TyiaxFs8Q";
// false : WeeCert n'envoie aucun e-mail (inscription sans lien de confirmation, mot de passe réinitialisé par l'administrateur).
// Passer à true après avoir configuré un service d'envoi (SMTP) dans Supabase et réactivé « Confirm email ».
export const EMAILS = false;
