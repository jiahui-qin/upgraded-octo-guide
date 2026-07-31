import fs from "fs";
import { parseDetailPage } from "../src/detailParser.js";

const html = fs.readFileSync("data/_detail_sample.html", "utf8");
const detail = parseDetailPage(html);
console.log(JSON.stringify(detail, null, 2));
