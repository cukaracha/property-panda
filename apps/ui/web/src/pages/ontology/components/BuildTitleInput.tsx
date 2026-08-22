import { Input } from '../../../components/ui/input';

interface BuildTitleInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** A name for the build. Saved ontologies are listed by this, so it is what makes
 *  a past build identifiable a week later. */
export default function BuildTitleInput({ value, onChange, disabled }: BuildTitleInputProps) {
  return (
    <div className='flex flex-col gap-1.5'>
      <label className='type-ui-eyebrow text-ink-4' htmlFor='build-title'>
        Name this ontology
      </label>
      <Input
        id='build-title'
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder='e.g. Q3 vendor contracts'
        maxLength={120}
        disabled={disabled}
      />
    </div>
  );
}
