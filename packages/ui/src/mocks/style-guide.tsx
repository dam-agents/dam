/**
 * Dev-only visual style guide. Shows every shadcn primitive + token the UI
 * uses so the designer can audit and tweak. Only renders when
 * `VITE_USE_MOCKS=true`. See ./README.md for removal.
 */
import {
  Asleep as Moon,
  ChevronDown,
  ChevronRight,
  Close as X,
  ColorPalette as Palette,
  Light as Sun,
  Notification as Bell,
} from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { AppStatusPill } from "@/components/app-status-pill";
import { StatusBadge } from "@/components/status-indicator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { useStore } from "../store.js";

const SHADCN_TOKENS: { name: string; cssVar: string; bg: string }[] = [
  { name: "background", cssVar: "--background", bg: "bg-background" },
  { name: "foreground", cssVar: "--foreground", bg: "bg-foreground" },
  { name: "card", cssVar: "--card", bg: "bg-card" },
  { name: "card-foreground", cssVar: "--card-foreground", bg: "bg-card-foreground" },
  { name: "popover", cssVar: "--popover", bg: "bg-popover" },
  { name: "popover-foreground", cssVar: "--popover-foreground", bg: "bg-popover-foreground" },
  { name: "primary", cssVar: "--primary", bg: "bg-primary" },
  { name: "primary-foreground", cssVar: "--primary-foreground", bg: "bg-primary-foreground" },
  { name: "secondary", cssVar: "--secondary", bg: "bg-secondary" },
  { name: "secondary-foreground", cssVar: "--secondary-foreground", bg: "bg-secondary-foreground" },
  { name: "muted", cssVar: "--muted", bg: "bg-muted" },
  { name: "muted-foreground", cssVar: "--muted-foreground", bg: "bg-muted-foreground" },
  { name: "destructive", cssVar: "--destructive", bg: "bg-destructive" },
  { name: "destructive-foreground", cssVar: "--destructive-foreground", bg: "bg-destructive-foreground" },
  { name: "border (input)", cssVar: "--input", bg: "bg-input" },
  { name: "ring", cssVar: "--ring", bg: "bg-ring" },
];

const STATUS_TOKENS: { name: string; cssVar: string; bg: string; text: string }[] = [
  { name: "success", cssVar: "--c-success", bg: "bg-success", text: "text-success" },
  { name: "success-light", cssVar: "--c-success-light", bg: "bg-success-light", text: "text-success" },
  { name: "warning", cssVar: "--c-warning", bg: "bg-warning", text: "text-warning" },
  { name: "warning-light", cssVar: "--c-warning-light", bg: "bg-warning-light", text: "text-warning" },
  { name: "info", cssVar: "--c-info", bg: "bg-info", text: "text-info" },
  { name: "info-light", cssVar: "--c-info-light", bg: "bg-info-light", text: "text-info" },
  { name: "template", cssVar: "--c-template", bg: "bg-template", text: "text-template" },
  { name: "template-light", cssVar: "--c-template-light", bg: "bg-template-light", text: "text-template" },
];

export function StyleGuide({ onClose }: { onClose: () => void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-background">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center gap-4">
          <Palette className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Style Guide</h1>
          <Badge variant="secondary" className="ml-2">dev preview</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
              {theme === "dark" ? "Light" : "Dark"}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-12">
        <Section title="Typography" subtitle="IBM Plex Sans (body) + IBM Plex Mono (code)">
          <div className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Heading 1 — text-4xl font-bold</Label>
              <h1 className="text-4xl font-bold">The quick brown fox</h1>
            </div>
            <div>
              <Label className="text-muted-foreground">Heading 2 — text-2xl font-bold</Label>
              <h2 className="text-2xl font-bold">The quick brown fox</h2>
            </div>
            <div>
              <Label className="text-muted-foreground">Heading 3 — text-lg font-semibold</Label>
              <h3 className="text-lg font-semibold">The quick brown fox</h3>
            </div>
            <div>
              <Label className="text-muted-foreground">Body — text-base</Label>
              <p className="text-base">The quick brown fox jumps over the lazy dog. 0123456789</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Small — text-sm text-muted-foreground</Label>
              <p className="text-sm text-muted-foreground">Subtle secondary text for metadata and hints.</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Mono — font-mono text-sm</Label>
              <pre className="font-mono text-sm">const x = &quot;hello world&quot;;</pre>
            </div>
          </div>
        </Section>

        <Section title="Shadcn Tokens" subtitle="The core palette every component draws from">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {SHADCN_TOKENS.map((t) => (
              <Swatch key={t.name} {...t} />
            ))}
          </div>
        </Section>

        <Section title="Status Tokens" subtitle="Custom brand tokens kept alongside shadcn">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {STATUS_TOKENS.map((t) => (
              <Swatch key={t.name} {...t} />
            ))}
          </div>
        </Section>

        <Section title="Buttons" subtitle="All variants × all sizes">
          <div className="space-y-4">
            <VariantRow label="default">
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="icon"><Bell /></Button>
              <Button disabled>Disabled</Button>
            </VariantRow>
            <VariantRow label="destructive">
              <Button variant="destructive" size="sm">Small</Button>
              <Button variant="destructive">Default</Button>
              <Button variant="destructive" size="lg">Large</Button>
              <Button variant="destructive" size="icon" aria-label="icon"><Bell /></Button>
            </VariantRow>
            <VariantRow label="outline">
              <Button variant="outline" size="sm">Small</Button>
              <Button variant="outline">Default</Button>
              <Button variant="outline" size="lg">Large</Button>
              <Button variant="outline" size="icon" aria-label="icon"><Bell /></Button>
            </VariantRow>
            <VariantRow label="secondary">
              <Button variant="secondary" size="sm">Small</Button>
              <Button variant="secondary">Default</Button>
              <Button variant="secondary" size="lg">Large</Button>
            </VariantRow>
            <VariantRow label="ghost">
              <Button variant="ghost" size="sm">Small</Button>
              <Button variant="ghost">Default</Button>
              <Button variant="ghost" size="icon" aria-label="icon"><Bell /></Button>
            </VariantRow>
            <VariantRow label="link">
              <Button variant="link">Link button</Button>
            </VariantRow>
          </div>
        </Section>

        <Section title="Badges" subtitle="All variants + custom status pills">
          <div className="space-y-4">
            <VariantRow label="shadcn">
              <Badge>default</Badge>
              <Badge variant="secondary">secondary</Badge>
              <Badge variant="destructive">destructive</Badge>
              <Badge variant="outline">outline</Badge>
            </VariantRow>
            <VariantRow label="agent state">
              <StatusBadge state="running" />
              <StatusBadge state="starting" />
              <StatusBadge state="hibernating" />
              <StatusBadge state="hibernated" />
              <StatusBadge state="error" />
              <StatusBadge state="no-instance" />
            </VariantRow>
            <VariantRow label="app connection">
              <AppStatusPill status="connected" />
              <AppStatusPill status="expired" />
              <AppStatusPill status="disconnected" />
              <AppStatusPill status="unknown" />
            </VariantRow>
          </div>
        </Section>

        <Section title="Form inputs" subtitle="Input, textarea, select, checkbox, switch, radio">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="sg-input">Input</Label>
              <Input id="sg-input" placeholder="Type something..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-input-disabled">Disabled input</Label>
              <Input id="sg-input-disabled" placeholder="Disabled" disabled />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="sg-textarea">Textarea</Label>
              <Textarea id="sg-textarea" placeholder="Multiple lines of text go here..." />
            </div>
            <div className="space-y-2">
              <Label>Select</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a">Option A</SelectItem>
                  <SelectItem value="b">Option B</SelectItem>
                  <SelectItem value="c">Option C</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label>Checkbox & Switch</Label>
              <div className="flex items-center gap-3">
                <Checkbox id="sg-check" defaultChecked />
                <Label htmlFor="sg-check">I agree</Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch id="sg-switch" defaultChecked />
                <Label htmlFor="sg-switch">Enabled</Label>
              </div>
            </div>
            <div className="space-y-3 md:col-span-2">
              <Label>Radio group</Label>
              <RadioGroup defaultValue="one" className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="one" id="r1" />
                  <Label htmlFor="r1">Option one</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="two" id="r2" />
                  <Label htmlFor="r2">Option two</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="three" id="r3" />
                  <Label htmlFor="r3">Option three</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </Section>

        <Section title="Cards" subtitle="Content container with header, content, footer">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Card Title</CardTitle>
                <CardDescription>A subtitle that sits under the title.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-foreground/80">
                  Card body content goes here. Anything can live inside — text, forms, lists, images.
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button variant="outline" size="sm">Cancel</Button>
                <Button size="sm">Action</Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src="" />
                    <AvatarFallback>AD</AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-base">Agent</CardTitle>
                    <CardDescription>With avatar + status</CardDescription>
                  </div>
                  <StatusBadge state="running" className="ml-auto" />
                </div>
              </CardHeader>
              <CardContent>
                <Progress value={64} />
                <p className="text-xs text-muted-foreground mt-2">64% complete</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section title="Overlays" subtitle="Dialog, alert-dialog, popover, tooltip, dropdown">
          <div className="flex flex-wrap gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Dialog title</DialogTitle>
                  <DialogDescription>Supporting description for the dialog content.</DialogDescription>
                </DialogHeader>
                <p className="text-sm text-foreground/80">Put body content here.</p>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Open alert</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. It will permanently remove the thing.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Confirm</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">
                  Open popover <ChevronDown />
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Popover title</p>
                  <p className="text-xs text-muted-foreground">Anchored to the trigger, repositions on overflow.</p>
                </div>
              </PopoverContent>
            </Popover>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover me</Button>
              </TooltipTrigger>
              <TooltipContent>Tooltip content</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Open menu <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem><ChevronRight /> Item one</DropdownMenuItem>
                <DropdownMenuItem><ChevronRight /> Item two</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Section>

        <Section title="Tabs" subtitle="Horizontal tab navigation">
          <Tabs defaultValue="first" className="w-full">
            <TabsList>
              <TabsTrigger value="first">First</TabsTrigger>
              <TabsTrigger value="second">Second</TabsTrigger>
              <TabsTrigger value="third">Third</TabsTrigger>
            </TabsList>
            <TabsContent value="first" className="text-sm text-foreground/80 p-4">
              First tab content.
            </TabsContent>
            <TabsContent value="second" className="text-sm text-foreground/80 p-4">
              Second tab content.
            </TabsContent>
            <TabsContent value="third" className="text-sm text-foreground/80 p-4">
              Third tab content.
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Progress & Separator">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Progress</Label>
              <Progress value={25} />
              <Progress value={50} />
              <Progress value={80} />
            </div>
            <div className="space-y-2">
              <Label>Separator</Label>
              <div>Above separator</div>
              <Separator />
              <div>Below separator</div>
            </div>
          </div>
        </Section>

        <div className="pb-12 pt-4 text-xs text-muted-foreground text-center">
          Dev-only — disable by unsetting <code className="font-mono">VITE_USE_MOCKS</code> in{" "}
          <code className="font-mono">packages/ui/.env.local</code>.
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="rounded-lg border bg-card p-6">{children}</div>
    </section>
  );
}

function VariantRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-xs font-mono text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Swatch({
  name,
  cssVar,
  bg,
}: {
  name: string;
  cssVar: string;
  bg: string;
  text?: string;
}) {
  const [resolved, setResolved] = useState("");
  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      setResolved(getComputedStyle(root).getPropertyValue(cssVar).trim());
    };
    read();
    // Re-read when the `dark` class flips on <html> — covers manual
    // theme toggles via the style-guide buttons AND prefers-color-scheme
    // changes that propagate through the global theme apply effect.
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [cssVar]);

  return (
    <div className="rounded-md border overflow-hidden">
      <div className={`h-16 ${bg} border-b`} />
      <div className="p-2">
        <div className="text-xs font-semibold truncate">{name}</div>
        <div className="text-[10px] font-mono text-muted-foreground">{cssVar}</div>
        <div className="text-[10px] font-mono text-muted-foreground truncate">{resolved || "—"}</div>
      </div>
    </div>
  );
}
