import { useState, useCallback } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import ProfileHeader from './components/ProfileHeader';
import ProfilePictureCard from './components/ProfilePictureCard';
import ClaudeTokenCard from './components/ClaudeTokenCard';
import ImageDeleteModal from './components/ImageDeleteModal';
import Toast, { type ToastItem } from '../../components/ui/toast';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The saved picture, read once at mount. Storage throws in private mode. */
function readStoredImage(): string | null {
  try {
    return localStorage.getItem('profileImage');
  } catch {
    return null;
  }
}

/**
 * The profile page. Two things live here that are genuinely per-person: the profile
 * picture, kept in localStorage, and the Claude subscription token every chat turn
 * runs on, kept by the local server and never sent back to the browser.
 *
 * The name, email and password cards this page used to carry were Cognito's. There is
 * no user pool behind a local app and no password to change, so they are gone rather
 * than left as controls that do nothing.
 */
export default function Profile() {
  const [profileImage, setProfileImage] = useState<string | null>(readStoredImage);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showImageDeleteConfirm, setShowImageDeleteConfirm] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(toast => toast.id !== id)), 5000);
  }, []);

  const processImageFile = (file: File) => {
    setIsUploadingImage(true);

    if (!file.type.startsWith('image/')) {
      addToast('error', 'Please select a valid image file');
      setIsUploadingImage(false);
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      addToast('error', 'Image size must be less than 5MB');
      setIsUploadingImage(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      const imageData = e.target?.result as string;
      setProfileImage(imageData);
      localStorage.setItem('profileImage', imageData);
      setIsUploadingImage(false);
      addToast('success', 'Profile picture updated');
    };
    reader.onerror = () => {
      setIsUploadingImage(false);
      addToast('error', 'Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processImageFile(file);
  };

  const removeProfileImage = () => {
    setProfileImage(null);
    localStorage.removeItem('profileImage');
    setShowImageDeleteConfirm(false);
    addToast('success', 'Profile picture removed');
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  };

  return (
    <div className='mx-auto max-w-3xl px-6 py-8'>
      <ProfileHeader />

      {toasts.map((toast, index) => (
        <Toast
          key={toast.id}
          toast={toast}
          index={index}
          onRemove={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
        />
      ))}

      <ProfilePictureCard
        profileImage={profileImage}
        isUploadingImage={isUploadingImage}
        isDragOver={isDragOver}
        onImageUpload={handleImageUpload}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onRequestDeletePicture={() => setShowImageDeleteConfirm(true)}
      />

      <ClaudeTokenCard onNotify={addToast} />

      <ImageDeleteModal
        isOpen={showImageDeleteConfirm}
        onCancel={() => setShowImageDeleteConfirm(false)}
        onConfirm={removeProfileImage}
      />
    </div>
  );
}
