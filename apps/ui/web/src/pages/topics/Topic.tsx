import { useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getTopic } from '../../data/topics';
import { useTopicPageContext } from './PageContext';

/**
 * Topic content page. Resolves :topicId (falls back to the first seeded topic),
 * renders the topic's seed markdown as an article, and sets the chat scope +
 * topicId so the floating assistant (mounted by AppLayout) can answer against
 * this topic's knowledge base.
 */
export default function Topic() {
  const { topicId } = useParams();
  const topic = getTopic(topicId);

  useTopicPageContext(topic);

  return (
    <div className='cv-main'>
      <article className='cv-article lesson'>
        <div className='topic-eyebrow'>
          {topic.code} · {topic.title}
        </div>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{topic.markdown}</ReactMarkdown>
      </article>
    </div>
  );
}
