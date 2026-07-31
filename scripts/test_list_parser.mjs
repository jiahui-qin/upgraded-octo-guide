import fs from "fs";
import { parseListPage } from "../src/listParser.js";

const html = fs.readFileSync("data/_list_sample.html", "utf8");
const { items, total, totalPage } = parseListPage(html);

console.log("total:", total, "totalPage:", totalPage, "items:", items.length);
console.log("=== first 2 items ===");
console.log(JSON.stringify(items.slice(0, 2), null, 2));
console.log("=== item without rating? ===");
const noRating = items.filter((i) => i.my_rating === null);
console.log("items without rating:", noRating.length);
if (noRating[0]) console.log(JSON.stringify(noRating[0], null, 2));
