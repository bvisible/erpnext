# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe.model.document import Document
from frappe.website.utils import delete_page_cache


class Homepage(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		company: DF.Link
		description: DF.Text
		hero_image: DF.AttachImage | None
		hero_section: DF.Link | None
		hero_section_based_on: DF.Literal["Default", "Slideshow", "Homepage Section"]
		slideshow: DF.Link | None
		tag_line: DF.Data
		title: DF.Data | None
	# end: auto-generated types

	def validate(self):
		#//// Neoffice: never seed the example-website sentence. A visitor must never
		#//// read "auto-generated from ERPNext" on a client's own domain (was live on
		#//// lo-alabouche.ch/berges/guigoz until 2026-07-10) — the platform name has
		#//// no business on a public homepage. Default to the company name instead.
		if not self.description:
			self.description = self.company or frappe._("Welcome")
		delete_page_cache("home")
