import { Suspense } from "react";
import { Batches } from "@/components/screens/Batches";

export const metadata = { title: "Batches, DairyWorks Vla" };

export default function BatchesPage() {
  return (
    <Suspense>
      <Batches />
    </Suspense>
  );
}
