import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTheme } from "@/contexts/theme-context";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/settings/accessibilitys")({
  component: RouteComponent,
});

function RouteComponent() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-col gap-2">
      <Label>Cài đặt giao diện</Label>
      <RadioGroup
        defaultValue={theme}
        onValueChange={(v) => {
          setTheme(v);
        }}
      >
        <FieldLabel htmlFor="light">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Sáng</FieldTitle>
              <FieldDescription>
                Giao diện ứng dụng chế độ sáng.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="light" id="light" />
          </Field>
        </FieldLabel>
        <FieldLabel htmlFor="dark">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Tối</FieldTitle>
              <FieldDescription>
                Giao diện ứng dụng chế độ tối.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="dark" id="dark" />
          </Field>
        </FieldLabel>
        <FieldLabel htmlFor="system">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldTitle>Hệ thông</FieldTitle>
              <FieldDescription>
                Giao diện ứng dụng sẽ chuyển đổi tự động chế độ sáng và tối theo
                máy tính.
              </FieldDescription>
            </FieldContent>
            <RadioGroupItem value="system" id="system" />
          </Field>
        </FieldLabel>
      </RadioGroup>
    </div>
  );
}
