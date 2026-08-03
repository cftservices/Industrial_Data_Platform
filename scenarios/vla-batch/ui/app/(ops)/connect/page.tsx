import { Suspense } from "react";
import { ConnectMap } from "@/components/screens/ConnectMap";

export const metadata = { title: "Connect, DairyWorks Vla" };

export default function ConnectPage() {
  return (
    <Suspense>
      <ConnectMap />
    </Suspense>
  );
}
