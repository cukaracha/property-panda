import ScrapeProgress, { type ScrapeProgressProps } from './ScrapeProgress';

export type SearchProgressOverlayProps = ScrapeProgressProps;

/**
 * The running scrape, raised over the filters that started it.
 *
 * Deliberately not dismissible, and with no cancel: the server has no way to stop
 * a job, so a close button would only stop the polling and leave a real Chrome
 * window scraping somewhere the user is no longer watching.
 */
export default function SearchProgressOverlay(props: SearchProgressOverlayProps) {
  return (
    <div className='modal-scrim' role='dialog' aria-modal='true' aria-label='Search in progress'>
      <div className='w-full max-w-md'>
        <ScrapeProgress {...props} />
      </div>
    </div>
  );
}
