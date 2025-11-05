# Guide de Test - POS Viewer

Ce document décrit comment tester la fonctionnalité POS Viewer.

## Prérequis

1. ERPNext installé et fonctionnel
2. Un utilisateur avec permissions POS (ou admin)
3. Un POS Profile configuré
4. Bench en mode développement (pour voir les logs)

## Étapes de test

### 1. Préparation de l'environnement

```bash
# Reconstruire les assets
cd ~/frappe-bench
bench build --app erpnext

# Ou effacer le cache
bench clear-cache

# Redémarrer le serveur (si nécessaire)
bench restart
```

### 2. Générer la clé API

1. Connectez-vous à ERPNext: `http://localhost:8000`
2. Allez dans **User** → **Administrator** (ou votre utilisateur de test)
3. Section **API Access**
4. Cliquez sur **Generate Keys**
5. Copiez le résultat au format: `api_key:api_secret`
6. Exemple: `abc123def456:xyz789uvw012`

### 3. Ouvrir une session POS

1. Allez dans **POS** (Point of Sale)
2. Sélectionnez un **POS Profile**
3. Cliquez sur **Open POS**
4. Une **POS Opening Entry** est créée
5. Laissez la fenêtre POS ouverte

### 4. Accéder à la page POS Viewer

1. Dans un nouvel onglet ou sur une tablette, ouvrez: `http://localhost:8000/pos-viewer`
2. Une modal d'authentification devrait s'afficher

### 5. Test d'authentification

#### Test 1: Authentification réussie
```
Action: Entrer la clé API au format correct
Résultat attendu:
- Modal se ferme
- Page principale s'affiche
- Nom d'utilisateur visible en haut à droite
- Profils POS disponibles dans le dropdown
```

#### Test 2: Authentification échouée
```
Action: Entrer une clé invalide
Résultat attendu:
- Message d'erreur affiché
- Reste sur la modal d'authentification
```

#### Test 3: Format invalide
```
Action: Entrer une clé sans ":"
Résultat attendu:
- Message d'erreur "Invalid format"
```

### 6. Test sélection de profil POS

#### Test 1: Sélection d'un profil
```
Action: Sélectionner un profil POS dans le dropdown
Résultat attendu:
- Profil changé
- Si session POS ouverte pour ce profil: panier s'affiche
- Si pas de session: message "No Active POS Session"
```

#### Test 2: Persistance du profil
```
Action:
1. Sélectionner un profil
2. Rafraîchir la page (F5)
Résultat attendu:
- Même profil sélectionné après refresh
```

### 7. Test affichage du panier en temps réel

#### Test 1: Panier vide
```
État initial: Aucun article dans le panier POS
Résultat attendu:
- Message "No items in cart"
- Icône de panier vide
- Pas de section totaux
```

#### Test 2: Ajout d'un article
```
Action: Dans la caisse POS, ajouter un article
Résultat attendu:
- Article apparaît IMMÉDIATEMENT dans le POS Viewer
- Affichage: image, nom, quantité, prix, montant
- Totaux mis à jour
- Badge de connexion: VERT (Connected)
```

#### Test 3: Modification de quantité
```
Action: Dans la caisse POS, changer la quantité d'un article
Résultat attendu:
- Quantité mise à jour en temps réel
- Montant recalculé
- Total général mis à jour
```

#### Test 4: Suppression d'un article
```
Action: Supprimer un article du panier POS
Résultat attendu:
- Article disparaît du POS Viewer
- Totaux recalculés
```

#### Test 5: Plusieurs articles
```
Action: Ajouter 5 articles différents
Résultat attendu:
- Les 5 articles s'affichent
- Chaque ligne avec image, détails, prix
- Scroll vertical si nécessaire
```

### 8. Test création de client

#### Test 1: Formulaire complet
```
Action:
1. Cliquer sur "Create Customer"
2. Remplir tous les champs:
   - Nom: "Jean Dupont"
   - Email: "jean@example.com"
   - Téléphone: "+33612345678"
   - Adresse: "123 Rue de la Paix"
   - Ville: "Paris"
   - Code postal: "75001"
   - Pays: "France"
3. Cliquer "Create Customer"

Résultat attendu:
- Message de succès
- Modal se ferme après 2 secondes
- Client créé dans ERPNext (vérifier dans Customer list)
```

#### Test 2: Nom seulement (champs minimums)
```
Action:
1. Cliquer sur "Create Customer"
2. Remplir uniquement le nom: "Marie Martin"
3. Cliquer "Create Customer"

Résultat attendu:
- Client créé avec succès
- Pas d'erreur pour champs optionnels vides
```

#### Test 3: Validation email
```
Action: Entrer un email invalide "notanemail"
Résultat attendu:
- Validation HTML5 empêche la soumission
- Message "Please enter a valid email"
```

#### Test 4: Nom vide
```
Action: Laisser le nom vide, cliquer "Create Customer"
Résultat attendu:
- Message d'erreur "Customer name is required"
```

### 9. Test indicateur de connexion

#### Test 1: Connexion normale
```
État: WebSocket connecté
Résultat attendu:
- Badge VERT avec "Connected"
- Point clignotant
```

#### Test 2: Connexion perdue
```
Action: Arrêter le serveur Redis (qui gère les WebSockets)
Résultat attendu:
- Badge passe au ROUGE "Disconnected"
- Polling de secours activé (refresh toutes les 5s)
```

### 10. Test responsive (tablette)

#### Test 1: Affichage tablette (768px)
```
Action: Redimensionner le navigateur à 768px de large
Résultat attendu:
- Layout adapté
- Tous les éléments visibles
- Pas de scroll horizontal
- Images des articles ajustées
```

#### Test 2: Rotation tablette
```
Action: Passer de portrait à paysage
Résultat attendu:
- Interface s'adapte automatiquement
- Aucune perte de fonctionnalité
```

### 11. Test déconnexion

#### Test 1: Logout manuel
```
Action: Cliquer sur "Logout"
Résultat attendu:
- Retour à la modal d'authentification
- localStorage effacé (vérifier avec F12 → Application → Local Storage)
- Champ API key vide
```

#### Test 2: Reconnexion
```
Action: Se reconnecter après logout
Résultat attendu:
- Authentification réussie
- Profil POS par défaut sélectionné
```

### 12. Test persistance localStorage

#### Test 1: Fermeture du navigateur
```
Action:
1. Se connecter et sélectionner un profil
2. Fermer complètement le navigateur
3. Rouvrir et accéder à /pos-viewer

Résultat attendu:
- Connexion automatique (pas de modal)
- Même profil POS sélectionné
```

#### Test 2: Nouvel onglet
```
Action: Ouvrir /pos-viewer dans un nouvel onglet
Résultat attendu:
- Même session utilisée
- Pas besoin de se reconnecter
```

### 13. Test de charge

#### Test 1: Panier avec 50 articles
```
Action: Ajouter 50 articles au panier POS
Résultat attendu:
- Tous les articles s'affichent
- Performance acceptable (<2s de chargement)
- Scroll fluide
```

#### Test 2: Mise à jour rapide
```
Action: Ajouter 10 articles très rapidement
Résultat attendu:
- Toutes les mises à jour sont capturées
- Pas de perte d'événements
```

## Debugging

### Logs à consulter

1. **Console navigateur (F12)**
   ```javascript
   // Vérifier les événements WebSocket
   // Rechercher: "Real-time cart update received"
   ```

2. **Logs serveur Frappe**
   ```bash
   tail -f ~/frappe-bench/logs/web.error.log
   ```

3. **Redis logs (WebSocket)**
   ```bash
   tail -f ~/frappe-bench/logs/redis_socketio.log
   ```

### Commandes utiles

```bash
# Effacer le cache complètement
bench clear-cache
bench clear-website-cache

# Reconstruire les assets
bench build --app erpnext

# Vérifier les erreurs Python
bench console
>>> import erpnext.www.pos_viewer.index
>>> # Pas d'erreur = OK

# Vérifier que la page est accessible
curl -I http://localhost:8000/pos-viewer
# Devrait retourner 200 OK
```

### Problèmes courants

#### Problème: "Module not found"
**Solution:**
```bash
bench migrate
bench build --app erpnext
bench restart
```

#### Problème: WebSocket ne fonctionne pas
**Solution:**
```bash
# Vérifier que Redis est en cours d'exécution
redis-cli ping
# Devrait retourner PONG

# Redémarrer les services
bench restart
```

#### Problème: Permissions insuffisantes
**Solution:**
1. Vérifier que l'utilisateur a le rôle "Sales User"
2. Vérifier les permissions sur "POS Invoice" et "Customer"
3. Utiliser l'administrateur pour les tests

## Checklist finale

- [ ] Authentification par clé API fonctionne
- [ ] Sélection de profil POS fonctionne et persiste
- [ ] Panier vide s'affiche correctement
- [ ] Ajout d'article met à jour en temps réel
- [ ] Modification de quantité se reflète immédiatement
- [ ] Suppression d'article fonctionne
- [ ] Images des articles s'affichent
- [ ] Totaux sont corrects
- [ ] Création de client fonctionne (tous les champs)
- [ ] Badge de connexion affiche le bon état
- [ ] Interface responsive sur tablette
- [ ] Logout efface les données
- [ ] Reconnexion automatique fonctionne
- [ ] Polling de secours fonctionne si WebSocket échoue
- [ ] Aucune erreur dans la console

## Rapport de test

Après avoir effectué tous les tests, remplissez ce rapport:

```
Date: __________
Testeur: __________
Version ERPNext: __________
Navigateur: __________

Résultats:
- Authentification: ✓ / ✗
- Profil POS: ✓ / ✗
- Temps réel: ✓ / ✗
- Création client: ✓ / ✗
- Responsive: ✓ / ✗
- Persistance: ✓ / ✗

Bugs trouvés:
1. __________
2. __________

Commentaires:
__________
```
