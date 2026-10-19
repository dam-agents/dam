import { useState } from "react";

import { Button } from "@/components/ui/button";

import { MeteringNotice } from "../../spend/components/metering-notice.js";
import {
  useEarlierEstimatesUntil,
  useMeteringNotice,
} from "../../spend/hooks/use-metering-notice.js";
import {
  HIDE_EARLIER_ESTIMATES,
  VIEW_EARLIER_ESTIMATES,
} from "../../spend/lib/copy.js";
import { EarlierEstimates } from "../views/earlier-estimates.js";

export function EarlierEstimatesAccess() {
  const [open, setOpen] = useState(false);
  const noticeShown = useMeteringNotice() !== null;
  const earlierUntil = useEarlierEstimatesUntil();
  const toggle = earlierUntil && (
    <Button
      variant="link"
      size="inline"
      aria-expanded={open}
      onClick={() => setOpen((wasOpen) => !wasOpen)}
      className="self-start text-sm"
    >
      {open ? HIDE_EARLIER_ESTIMATES : VIEW_EARLIER_ESTIMATES}
    </Button>
  );

  return (
    <>
      {noticeShown ? (
        <MeteringNotice className="mb-6">{toggle}</MeteringNotice>
      ) : (
        toggle && <p className="mb-6">{toggle}</p>
      )}
      {earlierUntil && open && (
        <EarlierEstimates closesOn={earlierUntil.slice(0, 10)} />
      )}
    </>
  );
}
