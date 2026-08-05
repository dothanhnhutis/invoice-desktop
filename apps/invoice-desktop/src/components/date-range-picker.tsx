import {
  addDays,
  differenceInCalendarDays,
  format,
  getDaysInMonth,
} from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { vi } from "react-day-picker/locale";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Số ngày tối đa cho khoảng có mốc neo (ngày muộn hơn) = `to`.
// = số ngày của tháng chứa NGÀY Ở GIỮA khoảng; tìm điểm bất động (hội tụ sau vài vòng).
function maxRangeDays(to: Date): number {
  let l = getDaysInMonth(to);
  for (let i = 0; i < 4; i++) {
    const mid = addDays(to, -Math.floor((l - 1) / 2)); // điểm giữa của [to-(l-1), to]
    const d = getDaysInMonth(mid);
    if (d === l) break;
    l = d;
  }
  return l;
}

// Khoảng mặc định: kết thúc ở `to` (mặc định hôm nay), lùi về trước đúng maxRangeDays (~1 tháng).
export function defaultOneMonthRange(to: Date = new Date()): DateRange {
  return { from: addDays(to, -(maxRangeDays(to) - 1)), to };
}

export function DateRangePicker({
  value,
  onChange,
  className,
}: {
  value?: DateRange;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
}) {
  const label = value?.from
    ? value.to
      ? `${format(value.from, "dd/MM/yyyy")} – ${format(value.to, "dd/MM/yyyy")}`
      : format(value.from, "dd/MM/yyyy")
    : "Chọn khoảng ngày lập";

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "justify-start gap-2 font-normal",
              !value?.from && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="size-4" />
            {label}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          locale={vi}
          mode="range"
          numberOfMonths={2}
          selected={value}
          onSelect={(range) => {
            if (!range?.from || !range?.to) {
              onChange(range);
              return;
            }
            // Kẹp độ dài khoảng theo tháng của điểm giữa; chỉ rút `from` (neo ở `to`).
            const maxL = maxRangeDays(range.to);
            const len = differenceInCalendarDays(range.to, range.from) + 1;
            onChange(
              len > maxL
                ? { from: addDays(range.to, -(maxL - 1)), to: range.to }
                : range,
            );
          }}
          showOutsideDays={false}
          fixedWeeks
          disabled={{ after: new Date() }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
