#!/usr/bin/env python3
"""Installe Carte Clients pour une nouvelle entreprise cliente, dans SON projet Supabase.

Lancé par la tâche GitHub « Nouvelle entreprise cliente » (.github/workflows/nouvelle-entreprise.yml).
Étapes (sur un projet Supabase neuf) :
  1. structure de la base et règles d'accès (supabase/migrations/*.sql, dans l'ordre) ;
  2. premier administrateur déclaré dans la liste des collaborateurs ;
  3. réglages de connexion : inscriptions fermées, double vérification, adresse de l'espace,
     e-mails en français, serveur d'e-mails professionnel si fourni ;
  4. création de l'espace entreprises/<nom>/ (même appli, reliée à cette base) ;
  5. invitation du premier administrateur (après le déploiement des fonctions, fait par la tâche).

Variables d'environnement : SUPABASE_ACCESS_TOKEN, PROJET (réf. Supabase, 20 caractères),
ESPACE (nom court : lettres, chiffres, tirets), ENTREPRISE, ADMIN (e-mail), SITE (adresse du site),
et facultativement SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_EXPEDITEUR.
Usage : nouvelle_entreprise.py base | espace | inviter
"""
import html, json, os, pathlib, re, sys, urllib.error, urllib.request

RACINE = pathlib.Path(__file__).resolve().parent.parent
API = 'https://api.supabase.com/v1'


def env(nom, requis=True):
    v = os.environ.get(nom, '').strip()
    if requis and not v:
        sys.exit(f'❌ Valeur manquante : {nom}')
    return v


def appel(methode, url, corps=None, entetes=None):
    donnees = json.dumps(corps).encode() if corps is not None else None
    h = {'Content-Type': 'application/json', 'Authorization': f"Bearer {env('SUPABASE_ACCESS_TOKEN')}", 'User-Agent': 'carte-clients'}
    h.update(entetes or {})
    req = urllib.request.Request(url, data=donnees, method=methode, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            texte = r.read().decode()
            return json.loads(texte) if texte.strip() else None
    except urllib.error.HTTPError as e:
        sys.exit(f'❌ {methode} {url.split("?")[0]} → {e.code} : {e.read().decode()[:400]}')


def verifier():
    projet, espace, admin = env('PROJET'), env('ESPACE'), env('ADMIN').lower()
    if not re.fullmatch(r'[a-z0-9]{20}', projet):
        sys.exit('❌ La référence du projet Supabase fait 20 lettres/chiffres (Project Settings → General → Project ID).')
    if not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?', espace) or espace in ('modele', 'demo'):
        sys.exit('❌ Nom d’espace invalide : minuscules, chiffres et tirets (ex. « boulangeries-martin »).')
    if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', admin):
        sys.exit('❌ E-mail du premier administrateur invalide.')
    return projet, espace, admin


def url_espace(espace):
    return env('SITE').rstrip('/') + f'/entreprises/{espace}/'


def sql(projet, requete):
    return appel('POST', f'{API}/projects/{projet}/database/query', {'query': requete})


INVITATION = """<h2>Bienvenue sur Carte Clients</h2>
<p>Vous êtes invité(e) à rejoindre l'espace Carte Clients de votre entreprise.</p>
<p><a href="{{ .ConfirmationURL }}">Choisir mon mot de passe</a></p>
<p>Ce lien est personnel et expire au bout de 24 heures.</p>"""
OUBLI = """<h2>Nouveau mot de passe</h2>
<p>Pour choisir un nouveau mot de passe Carte Clients, suivez ce lien :</p>
<p><a href="{{ .ConfirmationURL }}">Choisir un nouveau mot de passe</a></p>
<p>Si vous n'avez rien demandé, ignorez ce message.</p>"""


def base():
    projet, espace, admin = verifier()
    for f in sorted((RACINE / 'supabase' / 'migrations').glob('*.sql')):
        print(f'• {f.name}')
        sql(projet, f.read_text(encoding='utf8'))
    sql(projet, "insert into public.members (email, role) values ('%s', 'admin') on conflict (email) do update set role = 'admin';" % admin.replace("'", "''"))
    print(f'• premier administrateur : {admin}')
    site = url_espace(espace)
    reglages = {
        'site_url': site, 'uri_allow_list': site, 'disable_signup': True,
        'mfa_totp_enroll_enabled': True, 'mfa_totp_verify_enabled': True,
        'mailer_subjects_invite': 'Votre accès à Carte Clients', 'mailer_templates_invite_content': INVITATION,
        'mailer_subjects_recovery': 'Carte Clients : nouveau mot de passe', 'mailer_templates_recovery_content': OUBLI,
    }
    if env('SMTP_HOST', False):
        reglages.update({'smtp_host': env('SMTP_HOST'), 'smtp_port': env('SMTP_PORT', False) or '587', 'smtp_user': env('SMTP_USER'),
                         'smtp_pass': env('SMTP_PASS'), 'smtp_admin_email': env('SMTP_EXPEDITEUR'), 'smtp_sender_name': 'Carte Clients'})
        print('• serveur d’e-mails professionnel branché')
    else:
        print('⚠️ Pas de serveur d’e-mails fourni : Supabase n’enverra que quelques e-mails par heure.')
    appel('PATCH', f'{API}/projects/{projet}/config/auth', reglages)
    print(f'• connexion réglée pour {site} (inscriptions fermées, double vérification)')


def cles(projet):
    lst = appel('GET', f'{API}/projects/{projet}/api-keys?reveal=true') or []
    def cherche(*noms):
        for k in lst:
            if k.get('name') in noms or k.get('type') in noms:
                if k.get('api_key'):
                    return k['api_key']
        return None
    publique = cherche('anon', 'publishable')
    secrete = cherche('service_role', 'secret')
    if not publique or not secrete:
        sys.exit('❌ Clés du projet introuvables (Project Settings → API Keys).')
    return publique, secrete


def espace_():
    projet, espace, _ = verifier()
    publique, _ = cles(projet)
    nom = env('ENTREPRISE')
    dossier = RACINE / 'entreprises' / espace
    dossier.mkdir(parents=True, exist_ok=True)
    conf = json.dumps({'entreprise': nom, 'supabaseUrl': f'https://{projet}.supabase.co', 'supabaseAnonKey': publique}, ensure_ascii=False).replace('<', '\\u003c')
    page = (RACINE / 'entreprises' / 'modele' / 'index.html').read_text(encoding='utf8')
    page = page.replace('__ESPACE_JSON__', conf).replace('__ENTREPRISE__', html.escape(nom))
    (dossier / 'index.html').write_text(page, encoding='utf8')
    manif = json.loads((RACINE / 'entreprises' / 'modele' / 'manifest.webmanifest').read_text(encoding='utf8'))
    manif['name'] = f'Carte Clients · {nom}'
    (dossier / 'manifest.webmanifest').write_text(json.dumps(manif, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'• espace créé : entreprises/{espace}/ → {url_espace(espace)}')


def inviter():
    projet, espace, admin = verifier()
    _, secrete = cles(projet)
    h = {'apikey': secrete, 'Authorization': f'Bearer {secrete}'}
    req = urllib.request.Request(f'https://{projet}.supabase.co/auth/v1/invite', method='POST',
                                 data=json.dumps({'email': admin}).encode(), headers={'Content-Type': 'application/json', **h})
    try:
        with urllib.request.urlopen(req, timeout=60):
            print(f'• invitation envoyée à {admin}')
    except urllib.error.HTTPError as e:
        texte = e.read().decode()
        if e.code == 422 and 'already' in texte:
            print(f'• {admin} a déjà un compte : pas de nouvelle invitation')
        else:
            sys.exit(f'❌ Invitation impossible ({e.code}) : {texte[:300]}')


if __name__ == '__main__':
    {'base': base, 'espace': espace_, 'inviter': inviter}.get(sys.argv[1] if len(sys.argv) > 1 else '', lambda: sys.exit(__doc__))()
