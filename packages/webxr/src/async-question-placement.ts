import { Quaternion, Vector3 } from 'three'

// Head-relative lower center; independent of workspace panes and their lifetime.
export const ASYNC_QUESTION_OFFSET = new Vector3(0, -0.35, -1.25)
export const resolveAsyncQuestionPosition = (position: Vector3, orientation: Quaternion) =>
  ASYNC_QUESTION_OFFSET.clone().applyQuaternion(orientation).add(position)
