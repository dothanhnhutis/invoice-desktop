import {
  addDays,
  differenceInCalendarDays,
  format,
  getDaysInMonth,
  isSameDay,
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

// Số ngày tối đa cho khoảng neo tại `anchor`; `dir` = hướng khoảng trải ra
// (-1: anchor là `to`, khoảng lùi về trước; 1: anchor là `from`, khoảng tiến tới sau).
// = số ngày của tháng chứa NGÀY Ở GIỮA khoảng; tìm điểm bất động (hội tụ sau vài vòng).
function maxRangeDays(anchor: Date, dir: 1 | -1): number {
  let l = getDaysInMonth(anchor);
  for (let i = 0; i < 4; i++) {
    const mid = addDays(anchor, dir * Math.floor((l - 1) / 2)); // điểm giữa khoảng
    const d = getDaysInMonth(mid);
    if (d === l) break;
    l = d;
  }
  return l;
}

// Khoảng mặc định: kết thúc ở `to` (mặc định hôm nay), lùi về trước đúng maxRangeDays (~1 tháng).
export function defaultOneMonthRange(to: Date = new Date()): DateRange {
  return { from: addDays(to, -(maxRangeDays(to, -1) - 1)), to };
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
          onSelect={(range, triggerDate) => {
            if (!range?.from || !range?.to) {
              onChange(range);
              return;
            }
            // Kẹp độ dài khoảng theo tháng của điểm giữa: neo ở đầu người dùng
            // đã chọn TRƯỚC, chỉ rút đầu vừa bấm (`triggerDate`) lại.
            const { from, to } = range;
            const clampTo = !isSameDay(from, triggerDate); // vừa bấm là `to` -> neo `from`
            const maxL = clampTo ? maxRangeDays(from, 1) : maxRangeDays(to, -1);
            const len = differenceInCalendarDays(to, from) + 1;
            if (len <= maxL) {
              onChange(range);
              return;
            }
            onChange(
              clampTo
                ? { from, to: addDays(from, maxL - 1) }
                : { from: addDays(to, -(maxL - 1)), to },
            );
          }}
          showOutsideDays={false}
          fixedWeeks
          // Đã đủ khoảng -> bấm tiếp mở khoảng MỚI (mặc định của thư viện là nới
          // khoảng cũ, khiến khoảng mới luôn bị luật kẹp ~1 tháng kéo về chỗ cũ).
          resetOnSelect
          disabled={{ after: new Date() }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
