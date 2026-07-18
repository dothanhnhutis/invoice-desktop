import { cn } from "@/lib/utils";

import { useOnline } from "@/hooks/use-online";

const OnlineFooter = () => {
  const status = useOnline({
    probeUrl: "https://www.google.com",
  });
  return (
    <div
      className={cn(
        "fixed left-0 bottom-0 right-0 z-50 transition-transform duration-500 ease-in-out",
        status == "offline" || status == "checking"
          ? "translate-y-0 delay-0"
          : "translate-y-full delay-500",
        status == "offline" ? "bg-foreground" : "bg-green-700 ",
      )}
    >
      <p className="text-center text-background text-sm py-px">
        {status == "offline" ? "Không có kết nối" : "Quay lại trực tuyến..."}
      </p>
    </div>
  );
};

export default OnlineFooter;
