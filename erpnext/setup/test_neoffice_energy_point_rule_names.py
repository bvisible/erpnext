# //// Neoffice — added file (no upstream equivalent). A default energy point rule
# //// « On {0} Creation » names its doctype in the language it is made in (maintenance#2837).
#
# Upstream formats the rule's name with the doctype's English name: an install in French made
# « Sur Item Creation ». The doctype is a translated label like the sentence around it; the name of
# a rule made in English is unchanged. The translation function of the module is replaced by a
# small French one: the test reads the wiring, not the catalogue.

from unittest.mock import patch

from frappe.tests.utils import FrappeTestCase

from erpnext.setup import default_energy_point_rules as rules

FRENCH = {
	"On {0} Creation": "À la création : {0}",
	"Item": "Article",
	"Customer": "Client",
	"Supplier": "Fournisseur",
	"Lead": "Prospect",
}


def names(translate):
	with patch.object(rules, "_", side_effect=translate):
		made = rules.get_default_energy_point_rules()
	return {rule["reference_doctype"]: rule["rule_name"] for rule in made}


class TestADefaultCreationRuleNamesItsDoctypeInItsLanguage(FrappeTestCase):
	def test_a_creation_rule_made_in_french_names_the_doctype_in_french(self):
		made = names(lambda message, *args, **kwargs: FRENCH.get(message, message))
		self.assertEqual(made["Item"], "À la création : Article")
		self.assertEqual(made["Customer"], "À la création : Client")
		self.assertEqual(made["Supplier"], "À la création : Fournisseur")
		self.assertEqual(made["Lead"], "À la création : Prospect")

	def test_a_rule_made_in_english_keeps_its_upstream_name(self):
		made = names(lambda message, *args, **kwargs: message)
		self.assertEqual(made["Item"], "On Item Creation")
		self.assertEqual(made["Lead"], "On Lead Creation")
		self.assertEqual(made["Task"], "On Task Completion")
