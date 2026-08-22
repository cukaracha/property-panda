import { useState, useEffect, useCallback } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { updateUserAttributes, fetchUserAttributes, updatePassword } from 'aws-amplify/auth';
import { useAuth } from '../../context/AuthContext';
import { UserAttributeUtils } from '../../types/userAttributes';
import type { UserProfile, UserAttributes } from '../../types/userAttributes';
import ProfileHeader from './components/ProfileHeader';
import ProfilePictureCard from './components/ProfilePictureCard';
import PersonalInfoCard from './components/PersonalInfoCard';
import SecuritySettingsCard from './components/SecuritySettingsCard';
import ClaudeTokenCard from './components/ClaudeTokenCard';
import ActionsCard from './components/ActionsCard';
import DeleteAccountModal from './components/DeleteAccountModal';
import ImageDeleteModal from './components/ImageDeleteModal';
import Toast, { type ToastItem } from '../../components/ui/toast';

// Fields counted toward profile completion.
const COMPLETION_FIELDS: (keyof UserProfile)[] = ['firstName', 'lastName', 'email'];

/**
 * Profile management. Reads the signed-in user's Cognito attributes from
 * AuthContext, edits the standard attributes via Amplify updateUserAttributes,
 * and changes the password via Amplify updatePassword. The profile picture is a
 * localStorage-backed demo and the delete-account flow is simulated (no backend).
 */
export default function Profile() {
  const { userAttributes, isAdmin, isUser, isFederated } = useAuth();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [formData, setFormData] = useState<Partial<UserProfile>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fieldValidation, setFieldValidation] = useState<
    Record<string, { isValid: boolean; message: string }>
  >({});
  const [expandedPersonal, setExpandedPersonal] = useState(true);

  // Profile picture (localStorage demo)
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showImageDeleteConfirm, setShowImageDeleteConfirm] = useState(false);

  // Password change
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordStrength, setPasswordStrength] = useState(0);

  // Delete account (simulated)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(toast => toast.id !== id)), 5000);
  }, []);

  // Seed the profile + form from the Cognito attributes on AuthContext.
  useEffect(() => {
    if (userAttributes) {
      const p = UserAttributeUtils.cognitoToProfile(userAttributes as UserAttributes);
      setProfile(p);
      setFormData(p);
    }
    const savedImage = localStorage.getItem('profileImage');
    if (savedImage) setProfileImage(savedImage);
  }, [userAttributes]);

  const validateForm = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.firstName?.trim()) newErrors.firstName = 'First name is required';
    if (!formData.lastName?.trim()) newErrors.lastName = 'Last name is required';

    if (!formData.email?.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const calculateProfileCompletion = (): number => {
    const currentData = isEditing ? formData : profile;
    if (!currentData) return 0;
    const completed = COMPLETION_FIELDS.filter(
      field => currentData[field] && String(currentData[field]).trim() !== ''
    ).length;
    return Math.round((completed / COMPLETION_FIELDS.length) * 100);
  };

  const profileCompletion = calculateProfileCompletion();

  const validateField = (field: keyof UserProfile, value: string) => {
    switch (field) {
      case 'email':
        if (!value) return { isValid: false, message: 'Email is required' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return { isValid: false, message: 'Please enter a valid email address' };
        }
        return { isValid: true, message: '' };
      default:
        return { isValid: true, message: '' };
    }
  };

  const handleInputChange = (field: keyof UserProfile, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setFieldValidation(prev => ({ ...prev, [field]: validateField(field, value) }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleSave = async () => {
    if (isFederated) return;
    if (!validateForm()) return;

    setIsLoading(true);
    try {
      const cognitoUpdates: Record<string, string> = {};
      if (formData.email !== undefined) cognitoUpdates.email = formData.email;
      if (formData.firstName !== undefined) cognitoUpdates.given_name = formData.firstName;
      if (formData.lastName !== undefined) cognitoUpdates.family_name = formData.lastName;

      await updateUserAttributes({ userAttributes: cognitoUpdates });

      const fresh = await fetchUserAttributes();
      const updated = UserAttributeUtils.cognitoToProfile(fresh as UserAttributes);
      setProfile(updated);
      setFormData(updated);
      setIsEditing(false);
      addToast('success', 'Profile updated successfully!');
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : 'Failed to update profile. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setFormData(profile || {});
    setErrors({});
    setFieldValidation({});
    setIsEditing(false);
  };

  const handlePasswordInputChange = (field: keyof typeof passwordData, value: string) => {
    setPasswordData(prev => ({ ...prev, [field]: value }));

    if (field === 'newPassword') {
      let strength = 0;
      if (value.length >= 8) strength += 25;
      if (/[a-z]/.test(value)) strength += 25;
      if (/[A-Z]/.test(value)) strength += 25;
      if (/\d/.test(value)) strength += 25;
      setPasswordStrength(strength);
    }

    if (passwordErrors[field]) {
      setPasswordErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validatePasswordForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!passwordData.currentPassword) {
      newErrors.currentPassword = 'Current password is required';
    }

    if (!passwordData.newPassword) {
      newErrors.newPassword = 'New password is required';
    } else if (passwordData.newPassword.length < 8) {
      newErrors.newPassword = 'Password must be at least 8 characters long';
    } else if (!/(?=.*[a-z])/.test(passwordData.newPassword)) {
      newErrors.newPassword = 'Password must contain at least one lowercase letter';
    } else if (!/(?=.*[A-Z])/.test(passwordData.newPassword)) {
      newErrors.newPassword = 'Password must contain at least one uppercase letter';
    } else if (!/(?=.*\d)/.test(passwordData.newPassword)) {
      newErrors.newPassword = 'Password must contain at least one number';
    }

    if (!passwordData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password';
    } else if (passwordData.newPassword !== passwordData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setPasswordErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handlePasswordSave = async () => {
    if (isFederated) return;
    if (!validatePasswordForm()) return;

    setIsChangingPassword(true);
    try {
      await updatePassword({
        oldPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword,
      });
      addToast('success', 'Password changed successfully!');
      handlePasswordCancel();
    } catch (error) {
      addToast(
        'error',
        error instanceof Error
          ? error.message
          : 'Failed to change password. Please check your current password and try again.'
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handlePasswordCancel = () => {
    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordErrors({});
    setPasswordStrength(0);
    setShowPasswordChange(false);
  };

  const processImageFile = (file: File) => {
    setIsUploadingImage(true);

    if (!file.type.startsWith('image/')) {
      addToast('error', 'Please select a valid image file');
      setIsUploadingImage(false);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
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
      addToast('success', 'Profile picture updated successfully!');
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

  const handleDeleteAccount = async () => {
    if (isFederated) return;
    if (!deletePassword.trim()) {
      addToast('error', 'Please enter your password to confirm account deletion');
      return;
    }

    setIsDeletingAccount(true);
    try {
      // Demo only — no real account deletion. Simulate the request round-trip.
      await new Promise(resolve => setTimeout(resolve, 2000));
      addToast(
        'success',
        'Account deletion request submitted. You will receive a confirmation email.'
      );
      setShowDeleteConfirm(false);
      setDeletePassword('');
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : 'Failed to delete account. Please try again.'
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const exportProfileData = () => {
    if (!profile) return;
    const dataStr = JSON.stringify(profile, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'profile-data.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const getUserRole = () => {
    if (isAdmin()) return 'Administrator';
    if (isUser()) return 'User';
    return 'Unknown';
  };

  if (!profile) {
    return (
      <div className='mx-auto max-w-3xl px-6 py-8'>
        <div className='flex flex-col gap-6'>
          <div className='h-24 animate-pulse rounded-surface bg-panel-2' />
          <div className='h-64 animate-pulse rounded-surface bg-panel-2' />
          <div className='h-64 animate-pulse rounded-surface bg-panel-2' />
        </div>
      </div>
    );
  }

  return (
    <div className='mx-auto max-w-3xl px-6 py-8'>
      <ProfileHeader profileCompletion={profileCompletion} />

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

      <PersonalInfoCard
        formData={formData}
        isEditing={isEditing}
        isFederated={isFederated}
        errors={errors}
        fieldValidation={fieldValidation}
        expanded={expandedPersonal}
        onToggleExpand={() => setExpandedPersonal(prev => !prev)}
        onInputChange={handleInputChange}
        onEdit={() => setIsEditing(true)}
        onCancel={handleCancel}
        onSave={handleSave}
        isLoading={isLoading}
        getUserRole={getUserRole}
      />

      <ClaudeTokenCard onNotify={addToast} />

      {!isFederated && (
        <SecuritySettingsCard
          showPasswordChange={showPasswordChange}
          onShowPasswordChange={() => setShowPasswordChange(true)}
          onCancelPasswordChange={handlePasswordCancel}
          passwordData={passwordData}
          passwordErrors={passwordErrors}
          passwordStrength={passwordStrength}
          onPasswordInputChange={handlePasswordInputChange}
          onSavePassword={handlePasswordSave}
          isChangingPassword={isChangingPassword}
        />
      )}

      <ActionsCard
        onExport={exportProfileData}
        onRequestDeleteAccount={() => setShowDeleteConfirm(true)}
        canDeleteAccount={!isFederated}
      />

      <DeleteAccountModal
        isOpen={showDeleteConfirm}
        password={deletePassword}
        onPasswordChange={setDeletePassword}
        onCancel={() => {
          setShowDeleteConfirm(false);
          setDeletePassword('');
        }}
        onConfirm={handleDeleteAccount}
        isDeleting={isDeletingAccount}
      />

      <ImageDeleteModal
        isOpen={showImageDeleteConfirm}
        onCancel={() => setShowImageDeleteConfirm(false)}
        onConfirm={removeProfileImage}
      />
    </div>
  );
}
