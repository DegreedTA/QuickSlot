import { Plus } from '@phosphor-icons/react';
import { Button, Card, CopyIconButton, Select, STATUSES, StatusChip, TextInput, type ButtonSize, type ButtonVariant, type Status } from '../components/ui';

const sizes: ButtonSize[] = ['sm', 'md', 'lg'];
const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost'];

/* Dev-only proof page for the shared primitives (route /__ui, not mounted in production). */
export default function UiKit() {
  return (
    <main id="main" style={{ padding: 32, display: 'grid', gap: 24, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-h2)', fontWeight: 800, letterSpacing: 'var(--ls-display)' }}>UI primitives</h1>
      <Card style={{ padding: 24, display: 'grid', gap: 16 }}>
        <h2>Button</h2>
        {sizes.map((s) => (
          <div key={s} style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ width: 28 }}>{s}</code>
            {variants.map((v) => (
              <Button key={v} size={s} variant={v}>
                <Plus weight="bold" aria-hidden /> {v}
              </Button>
            ))}
          </div>
        ))}
      </Card>
      <Card style={{ padding: 24, display: 'grid', gap: 24 }}>
        <h2>IconButton, TextInput, Select</h2>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap', paddingTop: 36 }}>
          <CopyIconButton text="https://example.com/abc" />
          <div style={{ width: 280 }}>
            <TextInput label="Candidate name" placeholder="Jane Doe" />
          </div>
          <Select aria-label="Sort" defaultValue="recent">
            <option value="recent">Most recent</option>
            <option value="name">Name</option>
          </Select>
          <Select size="lg" aria-label="Time zone" defaultValue="et">
            <option value="et">Eastern Time</option>
            <option value="pt">Pacific Time</option>
          </Select>
        </div>
      </Card>
      <Card style={{ padding: 24, display: 'grid', gap: 12 }}>
        <h2>StatusChip</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {(Object.keys(STATUSES) as Status[]).map((s) => (
            <StatusChip key={s} status={s} />
          ))}
        </div>
      </Card>
    </main>
  );
}
