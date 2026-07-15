import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import {
  TemplateCreateFormBody,
  type TemplateCreateFormProps,
} from "./template-create-form-body.js";

export function TemplateCreateForm(props: TemplateCreateFormProps) {
  const { template } = props;
  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader>
        <h2 className="text-[20px] font-bold text-foreground">
          Add {template.name}
        </h2>
        {template.description && (
          <p className="text-[13px] text-foreground/80 mt-1">
            {template.description}
          </p>
        )}
      </DialogHeader>
      <TemplateCreateFormBody
        {...props}
        layout={(fields, footer) => (
          <>
            <DialogBody>{fields}</DialogBody>
            <DialogFooter>{footer}</DialogFooter>
          </>
        )}
      />
    </Modal>
  );
}
