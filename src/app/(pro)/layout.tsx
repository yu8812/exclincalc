import "./pro.css";
import ProAuthGuard from "@/components/pro/ProAuthGuard";
import ProSidebar from "@/components/pro/ProSidebar";
import ProTopBar from "@/components/pro/ProTopBar";
import ProSettingsApplier from "@/components/pro/ProSettingsApplier";
import DemoBanner from "@/components/pro/DemoBanner";

export const metadata = {
  title: "ClinCalc Pro | 醫師臨床決策系統",
};

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProAuthGuard>
      <div className="pro-root">
        <ProSettingsApplier />
        <ProSidebar />
        <div className="pro-content">
          <ProTopBar />
          <DemoBanner />
          <main className="pro-main">{children}</main>
        </div>
      </div>
    </ProAuthGuard>
  );
}
