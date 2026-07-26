import JournalView from "@/components/journal/JournalView";

export const metadata = {
  title: "Journal — TradeSpace",
};

export default function JournalPage() {
  return (
    <div className="w-full h-screen bg-[#0E0E0E] text-[#EDEDED] overflow-y-auto">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <JournalView />
      </div>
    </div>
  );
}
