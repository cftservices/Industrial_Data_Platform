import { Suspense } from "react";
import { ReportCentre } from "@/components/screens/ReportCentre";

export const metadata = { title: "Rapporten, DairyWorks Vla" };

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportCentre />
    </Suspense>
  );
}
