import frappe
from frappe.utils import flt
from erpnext.accounts.doctype.shipping_rule.shipping_rule import ShippingRule

def test_shipping_calculation():
    """Test complet du calcul de shipping avec les vraies données"""
    
    print("="*60)
    print("TEST CALCUL SHIPPING - 2 VALVES + 1 FUSIL")
    print("="*60)
    
    # Test 1: La méthode calculate_optimal_packing
    print("\n1. TEST calculate_optimal_packing")
    print("-"*40)
    
    # Créer les items exactement comme ils apparaissent
    packing_items = []
    
    # 2 valves (6x1x1 cm chacune)
    for i in range(2):
        packing_items.append({
            "name": f"valve_{i+1}",
            "length": 6,
            "width": 1, 
            "height": 1,
            "weight": 0.01  # 10g en kg
        })
    
    # 1 fusil (89x33x14 cm)
    packing_items.append({
        "name": "rifle",
        "length": 89,
        "width": 33,
        "height": 14,
        "weight": 0.1  # 100g en kg
    })
    
    print("Items pour le packing:")
    for item in packing_items:
        print(f"  {item['name']}: {item['length']}x{item['width']}x{item['height']} cm")
    
    # Calculer avec notre algorithme
    result = ShippingRule.calculate_optimal_packing(packing_items)
    
    print(f"\nRÉSULTAT:")
    print(f"  Longueur: {result['length']} cm")
    print(f"  Largeur: {result['width']} cm")  
    print(f"  Hauteur: {result['height']} cm")
    
    # Analyser le résultat
    if result['length'] > 100:
        print(f"\n❌ PROBLÈME: Longueur {result['length']} > 100 cm")
        print("   → Ne rentre pas dans PostPac Priority")
        print("   → Va utiliser 'Livraison Prioritaire' (>98.001 cm)")
    elif result['length'] > 98:
        print(f"\n⚠️ ATTENTION: Longueur {result['length']} cm est à la limite")
        print("   → PostPac Priority accepte jusqu'à 100 cm")
        print("   → 'Livraison Prioritaire' commence à 98.001 cm")
    else:
        print(f"\n✅ OK: Longueur {result['length']} cm")
        print("   → Compatible avec PostPac Priority (≤100 cm)")
    
    # Test 2: Vérifier comment l'algo traite les petits items
    print("\n2. ANALYSE DÉTAILLÉE DE L'ALGORITHME")
    print("-"*40)
    
    # Refaire le calcul avec debug
    items_data = []
    for item in packing_items:
        l = float(item.get("length", 0) or 0)
        w = float(item.get("width", 0) or 0)
        h = float(item.get("height", 0) or 0)
        if l > 0 and w > 0 and h > 0:
            vol = l * w * h
            items_data.append({
                "name": item["name"],
                "length": l,
                "width": w,
                "height": h,
                "volume": vol
            })
            print(f"  {item['name']}: volume = {vol} cm³")
    
    # Trier par volume
    items_data.sort(key=lambda x: x["volume"], reverse=True)
    largest = items_data[0]
    
    print(f"\nPlus grand article: {largest['name']} ({largest['volume']} cm³)")
    print(f"  Dimensions: {largest['length']}x{largest['width']}x{largest['height']} cm")
    
    # Vérifier les seuils pour les petits articles
    print("\nSeuils pour être considéré 'très petit':")
    print(f"  Longueur < {largest['length'] * 0.1} cm")
    print(f"  Largeur < {largest['width'] * 0.1} cm")
    print(f"  Hauteur < {largest['height'] * 0.1} cm")
    
    # Traiter les autres articles
    for item in items_data[1:]:
        print(f"\nArticle {item['name']} ({item['length']}x{item['width']}x{item['height']}):")
        
        is_small = (item["length"] <= largest["length"] * 0.1 and 
                   item["width"] <= largest["width"] * 0.1 and 
                   item["height"] <= largest["height"] * 0.1)
        
        if is_small:
            print(f"  → Très petit, rentre dans les espaces vides ✓")
        else:
            print(f"  → Trop grand, nécessite plus d'espace ✗")
            print(f"    Nouvelle longueur: max({largest['length']}, {item['length']}) = {max(largest['length'], item['length'])}")
    
    return result

# Point d'entrée pour bench execute
def run():
    return test_shipping_calculation()

if __name__ == "__main__":
    test_shipping_calculation()