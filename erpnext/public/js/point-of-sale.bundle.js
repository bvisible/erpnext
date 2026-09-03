//// Neoffice — the import ORDER of this bundle differs from upstream: pos_controller.js is
//// pulled FIRST (upstream imports it last) and pos_payment.js last (upstream imports it in the
//// middle). Same eight modules, no addition. Origin: da71070613 (2023-11-15 "updates for v15")
//// then a5f79d75b3 (2025-02-26 "update neov2"); neither states a reason — TO REVIEW.
//// It is not cosmetic: these modules assign onto erpnext.PointOfSale at evaluation time, so
//// the order decides which definition wins if two of them ever touch the same symbol.
import "../../selling/page/point_of_sale/pos_controller.js";
import "../../selling/page/point_of_sale/pos_item_cart.js";
import "../../selling/page/point_of_sale/pos_item_details.js";
import "../../selling/page/point_of_sale/pos_item_selector.js";
import "../../selling/page/point_of_sale/pos_number_pad.js";
import "../../selling/page/point_of_sale/pos_past_order_list.js";
import "../../selling/page/point_of_sale/pos_past_order_summary.js";
import "../../selling/page/point_of_sale/pos_payment.js";
