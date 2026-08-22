import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import '../../../components/assistant/markdown.css';

export interface MarkdownResultProps {
  pages: string[];
}

/** Renders the converted markdown page(s) with paging, in the design-system card. */
export default function MarkdownResult({ pages }: MarkdownResultProps) {
  const [current, setCurrent] = useState(0);
  const total = pages.length;
  const multi = total > 1;

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <CardTitle className='text-lg'>Conversion result</CardTitle>
          {multi && (
            <div className='flex items-center gap-2'>
              <Button
                variant='secondary'
                size='sm'
                onClick={() => setCurrent(p => Math.max(0, p - 1))}
                disabled={current === 0}
                aria-label='Previous page'
              >
                <ChevronLeft className='h-4 w-4' />
              </Button>
              <span className='min-w-[84px] text-center text-sm text-ink-3'>
                Page {current + 1} of {total}
              </span>
              <Button
                variant='secondary'
                size='sm'
                onClick={() => setCurrent(p => Math.min(total - 1, p + 1))}
                disabled={current === total - 1}
                aria-label='Next page'
              >
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className='chat-markdown max-h-[600px] overflow-y-auto rounded-surface border border-line bg-panel p-5'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{pages[current]}</ReactMarkdown>
        </div>
      </CardContent>
    </Card>
  );
}
