import type { ChangeEvent, DragEvent } from 'react';
import { Camera, Trash2, User } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import { cn } from '../../../lib/utils';

interface ProfilePictureCardProps {
  profileImage: string | null;
  isUploadingImage: boolean;
  isDragOver: boolean;
  onImageUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onRequestDeletePicture: () => void;
}

/**
 * Profile picture card. Demo-only: the image is stored in localStorage, not
 * uploaded to any backend — there is no avatar storage in this app.
 */
export default function ProfilePictureCard({
  profileImage,
  isUploadingImage,
  isDragOver,
  onImageUpload,
  onDragOver,
  onDragLeave,
  onDrop,
  onRequestDeletePicture,
}: ProfilePictureCardProps) {
  return (
    <Card className='mb-6'>
      <CardHeader>
        <div className='flex items-center gap-3'>
          <Camera size={22} className='text-brand' />
          <div>
            <CardTitle>Profile Picture</CardTitle>
            <CardDescription>Upload a profile picture to personalize your account</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className='flex items-center gap-6'>
          <div
            className={cn(
              'relative rounded-full transition-all',
              isDragOver && 'ring-2 ring-line-brand'
            )}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div className='flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border border-line bg-sunken'>
              {profileImage ? (
                <img src={profileImage} alt='Profile' className='h-full w-full object-cover' />
              ) : (
                <User size={64} className='text-subtle' />
              )}
            </div>
            {isUploadingImage && (
              <div className='absolute inset-0 flex items-center justify-center rounded-full bg-page/70'>
                <Spinner size='lg' />
              </div>
            )}
          </div>

          <div className='flex flex-col gap-3'>
            <div>
              <input
                type='file'
                id='profile-image'
                accept='image/*'
                onChange={onImageUpload}
                className='hidden'
                disabled={isUploadingImage}
              />
              <label
                htmlFor='profile-image'
                className={cn(
                  'btn btn-secondary cursor-pointer',
                  isUploadingImage && 'pointer-events-none opacity-50'
                )}
              >
                <Camera size={16} />
                {profileImage ? 'Change Picture' : 'Upload Picture'}
              </label>
            </div>

            {profileImage && (
              <Button
                variant='destructive'
                onClick={onRequestDeletePicture}
                disabled={isUploadingImage}
              >
                <Trash2 size={16} />
                Remove Picture
              </Button>
            )}

            <p className='text-xs text-muted'>Supported formats: JPG, PNG, GIF (max 5MB)</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
