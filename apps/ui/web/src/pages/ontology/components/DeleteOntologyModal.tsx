import ConfirmationModal from '../../../components/modals/ConfirmationModal';
import { deleteOntology, type OntologySummary } from '../../../services/ontologyService';

interface DeleteOntologyModalProps {
  isOpen: boolean;
  build: OntologySummary | null;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Confirms deleting one saved ontology. The copy spells out everything that goes,
 * because the teardown reaches well past the graph the user is looking at.
 */
export default function DeleteOntologyModal({
  isOpen,
  build,
  onClose,
  onSuccess,
}: DeleteOntologyModalProps) {
  if (!build) return null;

  const handleConfirm = async () => {
    await deleteOntology(build.jobId);
  };

  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title='Delete ontology'
      description={`You are about to delete "${build.title}". Its source documents, graph outputs, search index entries and chat history will all be removed. This cannot be undone.`}
      confirmLabel='Delete ontology'
      checkboxLabel='I understand this will permanently delete this ontology and everything built from it.'
      successMessage={`"${build.title}" is being deleted.`}
      onSuccess={onSuccess}
    />
  );
}
