import { redirect } from "next/navigation";

export const metadata = {
  title: "Autonomous Journal — TradeSpace",
  description: "Advanced multi-model autonomous trading journal with AG-Grid spreadsheet analytics.",
};

export default function JournalPage() {
  redirect("/autonomous?section=journal");
}
