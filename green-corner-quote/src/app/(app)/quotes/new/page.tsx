import QuoteBuilder from "../QuoteBuilder";
import { loadBuilderCatalog } from "../builderData";

export const metadata = { title: "New quote" };

export default async function NewQuote() {
  return <QuoteBuilder catalog={await loadBuilderCatalog()} initial={{ id: null, name: "", notes: "", lines: [] }} />;
}
