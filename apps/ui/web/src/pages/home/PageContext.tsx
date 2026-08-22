import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAiModeStore } from '../../store/useAiModeStore';
import usePageContextStore from '../../store/usePageContextStore';
import { useTheme, setTheme } from '../../hooks/useTheme';
import { TOPICS } from '../../data/topics';
import type { Action } from '../../types/chatbot';

/**
 * Home chat presentation + human-in-the-loop context. Home is a general, unscoped
 * assistant (no topicId, so course_knowledge_base stays unscoped). It registers the
 * demo page actions (open a page, open a course, switch the theme) so the HITL
 * approve/reject flow is one click, and seeds matching suggestion chips that are
 * sent to the agent so it can act on the user's behalf. Clears both stores on unmount.
 */
const courseTitle = (id: string) => TOPICS.find(t => t.id === id)?.title ?? 'course';

export function useHomePageContext(): void {
  const setChatUi = useAiModeStore(state => state.setChatUi);
  const reset = useAiModeStore(state => state.reset);
  const setPageContext = usePageContextStore(state => state.setPageContext);
  const clearPageContext = usePageContextStore(state => state.clearPageContext);
  const navigate = useNavigate();
  const { theme } = useTheme();

  useEffect(() => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setChatUi({
      scope: undefined,
      topicId: undefined,
      suggestions: [
        'Convert a file using the markdown converter',
        'Invoke the number specialist subagent to generate a random number',
        'Open the quantum physics course',
        `Switch to the ${nextTheme} theme`,
      ],
    });
  }, [setChatUi, theme]);

  useEffect(() => {
    const actions: Action[] = [
      {
        name: 'open_converter',
        description:
          'Navigate the user to the document converter, where they can upload a file to convert to markdown.',
        parameters: {},
        example: '{"name": "open_converter"}',
        display: () => 'Open the document converter',
        callback: () => navigate('/converter'),
      },
      {
        name: 'open_course',
        description:
          'Open a knowledge base course page so the user can ask questions about that course.',
        parameters: {
          courseId:
            "The id of the course to open. Available values: 'phys2001' (Quantum Physics), 'arth1000' (Art History).",
        },
        example: '{"name": "open_course", "courseId": "phys2001"}',
        display: params => `Open the ${courseTitle(params.courseId)} course`,
        callback: params => navigate(`/topics/${params.courseId}`),
      },
      {
        name: 'set_theme',
        description: 'Switch the app between light and dark themes.',
        parameters: { theme: "Which theme to switch to: 'light' or 'dark'." },
        example: '{"name": "set_theme", "theme": "dark"}',
        display: params => `Switch to the ${params.theme === 'light' ? 'light' : 'dark'} theme`,
        callback: params => setTheme(params.theme === 'light' ? 'light' : 'dark'),
      },
    ];

    setPageContext({
      pageName: 'Home',
      pageDescription: {
        title: 'Home',
        purpose: 'A full-page chat with the assistant.',
        layout: 'A single chat column with a message thread and a composer.',
        sections: ['Assistant chat thread', 'Message composer'],
        notes:
          'The user can ask general questions or ask you to act on their behalf. You can open the document converter, open a knowledge base course, switch between light and dark themes, and delegate a random number request to the number specialist subagent.',
      },
      contentDetailsProvider: null,
      actions,
    });

    return () => {
      reset();
      clearPageContext();
    };
  }, [setPageContext, clearPageContext, reset, navigate]);
}
