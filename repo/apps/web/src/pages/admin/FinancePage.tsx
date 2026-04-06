import { FinanceImportPanel } from '../../components/admin/FinanceImportPanel';
import { FinanceReviewPanel } from '../../components/admin/FinanceReviewPanel';
import { useFinanceWorkspace } from '../../hooks/useFinanceWorkspace';

export function FinancePage() {
  const finance = useFinanceWorkspace();

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,0.52fr)_minmax(360px,0.48fr)]">
      <FinanceImportPanel
        auditPath={finance.auditPath}
        canImportManifest={finance.canImportManifest}
        freightAmount={finance.freightAmount}
        invoiceReference={finance.invoiceReference}
        isImporting={finance.isPending('finance-import-manifest')}
        items={finance.items}
        metrics={finance.metrics}
        paymentPlanStatus={finance.paymentPlanStatus}
        sourceFilename={finance.sourceFilename}
        statementReference={finance.statementReference}
        supplierName={finance.supplierName}
        surchargeAmount={finance.surchargeAmount}
        onAddRow={finance.addManifestRow}
        onImport={() => void finance.importManifest()}
        onRemoveRow={finance.removeManifestRow}
        onUpdateItem={finance.updateManifestItem}
        onChangeSupplierName={finance.setSupplierName}
        onChangeSourceFilename={finance.setSourceFilename}
        onChangeStatementReference={finance.setStatementReference}
        onChangeInvoiceReference={finance.setInvoiceReference}
        onChangeFreightAmount={finance.setFreightAmount}
        onChangeSurchargeAmount={finance.setSurchargeAmount}
        onChangePaymentPlanStatus={finance.setPaymentPlanStatus}
      />
      <FinanceReviewPanel
        auditPath={finance.auditPath}
        canUpdateDiscrepancies={finance.canUpdateDiscrepancies}
        canUpdatePaymentPlans={finance.canUpdatePaymentPlans}
        isPending={finance.isPending}
        onUpdateDiscrepancyStatus={finance.updateDiscrepancyStatus}
        onUpdatePaymentPlanStatus={finance.updatePaymentPlanStatus}
        settlements={finance.settlements}
      />
    </div>
  );
}
