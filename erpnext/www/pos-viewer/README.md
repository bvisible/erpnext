# POS Viewer - External Cart Display

## Description

Page externe permettant de visualiser en temps réel le panier d'une caisse ERPNext POS. Cette page est conçue pour être affichée sur une tablette ou un écran secondaire, permettant aux clients de voir leur panier pendant que la caisse est utilisée par le vendeur.

## Fonctionnalités

- ✅ **Authentification par clé API** - Connexion sécurisée avec les credentials API d'ERPNext
- ✅ **Stockage persistant** - Les credentials et le profil POS sont sauvegardés dans localStorage
- ✅ **Sélection du profil POS** - Choix du profil de caisse avec sauvegarde automatique
- ✅ **Affichage en temps réel** - Mise à jour instantanée via WebSocket quand des articles sont ajoutés
- ✅ **Polling de secours** - Rafraîchissement automatique toutes les 5 secondes si WebSocket échoue
- ✅ **Création de clients** - Formulaire complet pour créer un nouveau client avec adresse
- ✅ **Design responsive** - Interface optimisée pour tablettes (768px+)
- ✅ **Indicateur de connexion** - Badge visuel montrant l'état de la connexion temps réel

## Accès

L'URL de la page est : `https://votre-site.erpnext.com/pos-viewer`

## Configuration requise

### 1. Générer une clé API pour l'utilisateur admin

1. Connectez-vous à ERPNext en tant qu'administrateur
2. Allez dans **User** → **Administrator**
3. Faites défiler jusqu'à la section **API Access**
4. Cliquez sur **Generate Keys**
5. Copiez la clé API et le secret API (format: `api_key:api_secret`)

**⚠️ Important:** Gardez ces credentials en sécurité. Ils donnent accès complet au compte admin.

### 2. Configurer le profil POS

1. Assurez-vous d'avoir créé un **POS Profile** dans ERPNext
2. Le profil doit être actif (non désactivé)
3. Ouvrez une session POS avec ce profil (**POS Opening Entry**)

### 3. Activer WebSocket (si nécessaire)

Le système utilise `frappe.realtime` qui nécessite que les WebSockets soient activés sur votre instance ERPNext (activé par défaut sur les installations modernes).

## Utilisation

### Première connexion

1. Ouvrez l'URL `/pos-viewer` dans votre navigateur
2. Une modal d'authentification s'affiche
3. Entrez vos credentials API au format `api_key:api_secret`
4. Cliquez sur **Connect**

### Après la première connexion

- La clé API est sauvegardée dans le localStorage du navigateur
- À la prochaine visite, vous serez automatiquement connecté
- Pour vous déconnecter, cliquez sur le bouton **Logout** en haut à droite

### Sélection du profil POS

1. En haut à droite, utilisez le menu déroulant **POS Profile**
2. Sélectionnez le profil de caisse actif
3. Votre choix est automatiquement sauvegardé

### Affichage du panier

- Le panier se met à jour **automatiquement** quand vous ajoutez des articles dans la caisse POS
- Chaque article affiche:
  - Image du produit
  - Nom et code de l'article
  - Quantité
  - Prix unitaire
  - Montant total de la ligne
- Les totaux affichent:
  - Quantité totale
  - Total net
  - Taxes
  - Remise (si applicable)
  - **Total général** (en vert)

### Création d'un client

1. Cliquez sur le bouton **Create Customer**
2. Remplissez le formulaire:
   - **Nom complet** (obligatoire)
   - Email
   - Numéro de téléphone
   - Adresse ligne 1
   - Ville
   - Code postal
   - Pays
3. Cliquez sur **Create Customer**
4. Le client est créé dans ERPNext et peut être sélectionné dans la caisse

## Indicateur de connexion

En haut à gauche, un badge coloré indique l'état de la connexion:

- 🟢 **Connected** (vert) - WebSocket connecté, mises à jour en temps réel
- 🔴 **Disconnected** (rouge) - WebSocket déconnecté, utilisation du polling de secours

## Architecture technique

### Backend (`index.py`)

Méthodes API disponibles:
- `validate_api_key(api_key_string)` - Validation des credentials API
- `get_pos_profiles()` - Liste des profils POS disponibles
- `get_pos_opening_entry(pos_profile)` - Session POS ouverte pour un profil
- `get_current_cart(pos_opening_entry)` - Panier actuel avec détails
- `create_customer(...)` - Création d'un nouveau client avec contact et adresse

### Frontend

- **index.html** - Template Jinja2 avec modals et structure HTML
- **index.js** - Classe `POSViewer` gérant toute la logique client
- **index.css** - Styles responsive optimisés pour tablettes

### Communication temps réel

L'événement WebSocket publié est: `pos_cart_updated_{pos_opening_entry_id}`

Modification effectuée dans `/erpnext/selling/page/point_of_sale/pos_controller.js` (ligne 734-745) pour publier l'événement à chaque mise à jour du panier.

## Sécurité

- ✅ Authentification requise par clé API
- ✅ Vérification des permissions POS Invoice (lecture)
- ✅ Validation des rôles utilisateur
- ✅ Protection CSRF automatique de Frappe
- ✅ Sanitization des inputs côté serveur
- ⚠️ La clé API est stockée en localStorage (encodée mais pas chiffrée)

**Recommandations:**
- Utilisez HTTPS en production
- Limitez l'accès physique aux appareils avec la page ouverte
- Changez régulièrement la clé API
- Utilisez un compte dédié avec permissions limitées si possible

## Dépannage

### La page n'affiche pas le panier

1. Vérifiez qu'une session POS est ouverte (**POS Opening Entry**)
2. Vérifiez que le profil POS sélectionné correspond à la session ouverte
3. Vérifiez que des articles ont été ajoutés au panier dans la caisse
4. Vérifiez l'indicateur de connexion en haut à gauche

### L'authentification échoue

1. Vérifiez que le format de la clé est correct: `api_key:api_secret`
2. Vérifiez que la clé API n'a pas été révoquée
3. Vérifiez que l'utilisateur a les permissions nécessaires

### Les mises à jour ne sont pas en temps réel

1. Vérifiez que les WebSockets sont activés sur votre instance
2. L'indicateur devrait être rouge (Disconnected)
3. Le système utilisera le polling automatique toutes les 5 secondes
4. Vérifiez les logs de la console navigateur (F12) pour les erreurs

### Effacer les données sauvegardées

Pour effacer la clé API et le profil sauvegardés:
1. Ouvrez la console du navigateur (F12)
2. Tapez:
   ```javascript
   localStorage.removeItem('pos_viewer_api_key');
   localStorage.removeItem('pos_viewer_selected_profile');
   ```
3. Ou cliquez simplement sur **Logout**

## Maintenance

### Reconstruction des assets

Après modification des fichiers, reconstruisez les assets:

```bash
bench build --app erpnext
# ou
bench clear-cache
```

### Désactivation de la fonctionnalité

Pour désactiver la fonctionnalité sans supprimer les fichiers, vous pouvez commenter la publication d'événements dans `pos_controller.js` (lignes 734-745).

## Support

Pour signaler un bug ou demander une amélioration, veuillez créer une issue sur le dépôt GitHub d'ERPNext.
